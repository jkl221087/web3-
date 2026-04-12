package com.efstore.backend;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;
import org.web3j.utils.Numeric;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
class AuthService {
    static final String SESSION_COOKIE = "fashion_store_session";

    private final SecureRandom random = new SecureRandom();
    private final Map<String, NonceRecord> nonces = new ConcurrentHashMap<>();
    private final Map<String, SessionRecord> sessions = new ConcurrentHashMap<>();

    Map<String, Object> issueNonce(String address, String chainId) {
        String normalized = StoreSupport.normalizeAddress(address);
        StoreSupport.require(
            StoreSupport.isValidEvmAddress(normalized),
            HttpStatus.BAD_REQUEST,
            "Address must be a valid EVM address"
        );
        cleanup();
        String nonce = randomHex(16);
        String message = """
            Escrow Fashion Store Login
            Address: %s
            Nonce: %s
            Chain ID: %s
            Issued At: %s
            """.formatted(
            normalized,
            nonce,
            chainId == null || chainId.isBlank() ? "unknown" : chainId,
            StoreSupport.nowIso()
        );
        nonces.put(normalized, new NonceRecord(message, Instant.now().plus(Duration.ofMinutes(10))));
        return Map.of(
            "address", normalized,
            "nonce", nonce,
            "message", message,
            "expiresAt", StoreSupport.nowIso()
        );
    }

    SessionLogin verify(String address, String message, String signature) {
        String normalized = StoreSupport.normalizeAddress(address);
        cleanup();
        NonceRecord record = nonces.get(normalized);
        if (record == null || record.expiresAt().isBefore(Instant.now()) || !record.message().equals(message)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "登入簽名已失效，請重新連接錢包");
        }
        String recovered = recoverAddress(message, signature);
        if (!normalized.equals(recovered)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Signature verification failed");
        }
        nonces.remove(normalized);
        String sessionId = UUID.randomUUID().toString().replace("-", "");
        long maxAge = Duration.ofDays(7).getSeconds();
        sessions.put(sessionId, new SessionRecord(normalized, Instant.now().plusSeconds(maxAge)));
        return new SessionLogin(sessionId, maxAge);
    }

    Optional<String> resolveActor(HttpServletRequest request, String headerActor) {
        cleanup();
        String sessionId = extractCookie(request, SESSION_COOKIE);
        if (sessionId != null) {
            SessionRecord session = sessions.get(sessionId);
            if (session != null && session.expiresAt().isAfter(Instant.now())) {
                return Optional.of(session.address());
            }
        }
        if (headerActor == null || headerActor.isBlank()) {
            return Optional.empty();
        }
        String actor = StoreSupport.normalizeAddress(headerActor);
        StoreSupport.require(
            StoreSupport.isValidEvmAddress(actor),
            HttpStatus.BAD_REQUEST,
            "Actor address must be a valid EVM address"
        );
        return Optional.of(actor);
    }

    void logout(HttpServletRequest request) {
        String sessionId = extractCookie(request, SESSION_COOKIE);
        if (sessionId != null) {
            sessions.remove(sessionId);
        }
    }

    String sessionCookie(String sessionId, long maxAgeSeconds) {
        return ResponseCookie.from(SESSION_COOKIE, sessionId)
            .httpOnly(true)
            .sameSite("Lax")
            .path("/")
            .maxAge(Duration.ofSeconds(maxAgeSeconds))
            .build()
            .toString();
    }

    String clearSessionCookie() {
        return ResponseCookie.from(SESSION_COOKIE, "")
            .httpOnly(true)
            .sameSite("Lax")
            .path("/")
            .maxAge(Duration.ZERO)
            .build()
            .toString();
    }

    private void cleanup() {
        Instant now = Instant.now();
        nonces.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        sessions.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    private String extractCookie(HttpServletRequest request, String name) {
        if (request.getCookies() == null) return null;
        return Arrays.stream(request.getCookies())
            .filter(cookie -> name.equals(cookie.getName()))
            .map(jakarta.servlet.http.Cookie::getValue)
            .findFirst()
            .orElse(null);
    }

    private String randomHex(int size) {
        byte[] data = new byte[size];
        random.nextBytes(data);
        StringBuilder builder = new StringBuilder(size * 2);
        for (byte value : data) {
            builder.append(String.format(Locale.ROOT, "%02x", value));
        }
        return builder.toString();
    }

    private String recoverAddress(String message, String signatureHex) {
        byte[] signature = Numeric.hexStringToByteArray(signatureHex);
        if (signature.length != 65) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid signature");
        }
        byte[] r = Arrays.copyOfRange(signature, 0, 32);
        byte[] s = Arrays.copyOfRange(signature, 32, 64);
        byte v = signature[64];
        if (v < 27) v += 27;
        try {
            BigInteger publicKey = Sign.signedPrefixedMessageToKey(
                message.getBytes(StandardCharsets.UTF_8),
                new Sign.SignatureData(v, r, s)
            );
            return StoreSupport.normalizeAddress("0x" + Keys.getAddress(publicKey));
        } catch (Exception error) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Signature verification failed");
        }
    }

    record SessionLogin(String sessionId, long maxAgeSeconds) {}
    record NonceRecord(String message, Instant expiresAt) {}
    record SessionRecord(String address, Instant expiresAt) {}
}
