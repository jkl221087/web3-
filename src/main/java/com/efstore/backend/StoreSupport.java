
package com.efstore.backend;

import org.springframework.http.HttpStatus;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.Locale;

final class StoreSupport {
    private StoreSupport() {}

    static String nowIso() {
        return OffsetDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    static String normalizeAddress(String address) {
        return address == null ? "" : address.trim().toLowerCase(Locale.ROOT);
    }

    static boolean isValidEvmAddress(String address) {
        if (address == null) return false;
        return address.trim().matches("^0x[a-fA-F0-9]{40}$");
    }

    static void require(boolean condition, HttpStatus status, String message) {
        if (!condition) {
            throw new ApiException(status, message);
        }
    }

    static String requireNonBlank(String value, HttpStatus status, String message) {
        require(value != null && !value.trim().isEmpty(), status, message);
        return value.trim();
    }

    static void requireUintString(String value, HttpStatus status, String message) {
        require(value != null && value.matches("^\\\\d+$"), status, message);
    }

    static void requireAddress(String address, HttpStatus status, String message) {
        require(isValidEvmAddress(address), status, message);
    }

    static String requireOneOf(String value, Collection<String> allowed, HttpStatus status, String message) {
        require(value != null && allowed.contains(value), status, message);
        return value;
    }

    static String safe(String value) {
        return value == null ? "" : value;
    }
}
