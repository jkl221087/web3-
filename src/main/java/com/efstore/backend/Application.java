package com.efstore.backend;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.web3j.crypto.Keys;
import org.web3j.crypto.Sign;
import org.web3j.utils.Numeric;

import javax.sql.DataSource;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Bean
    DataSource dataSource() {
        Path root = Paths.get("").toAbsolutePath();
        Path dataDir = root.resolve("data");
        try {
            Files.createDirectories(dataDir);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to create data directory", e);
        }
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.sqlite.JDBC");
        dataSource.setUrl("jdbc:sqlite:" + dataDir.resolve("store.db"));
        return dataSource;
    }
}

@Component
class StorePaths {
    final Path root = Paths.get("").toAbsolutePath();
    final Path frontendDir = root.resolve("frontend");
    final Path uploadsDir = root.resolve("uploads").resolve("products");
    final Path nodeModulesDir = root.resolve("node_modules");
}

@Component
class StaticResourceConfig implements WebMvcConfigurer {
    private final StorePaths paths;

    StaticResourceConfig(StorePaths paths) {
        this.paths = paths;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/frontend/**").addResourceLocations(paths.frontendDir.toUri().toString());
        registry.addResourceHandler("/uploads/**").addResourceLocations(paths.root.resolve("uploads").toUri().toString());
        registry.addResourceHandler("/node_modules/**").addResourceLocations(paths.nodeModulesDir.toUri().toString());
    }
}

@Controller
class RootPageController {
    @GetMapping("/")
    String root() {
        return "redirect:/frontend/entry.html";
    }
}

class ApiException extends RuntimeException {
    private final HttpStatus status;

    ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    HttpStatus status() {
        return status;
    }
}
