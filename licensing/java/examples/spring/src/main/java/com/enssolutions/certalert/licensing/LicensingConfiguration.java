package com.enssolutions.certalert.licensing;

import com.enssolutions.license.LicenseManager;
import com.enssolutions.license.LicenseVerifier;
import java.time.Instant;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Wires the ENS license into a Spring Boot application. The release date
 * comes from build-info (spring-boot-maven-plugin's build-info goal), which is
 * what lets a perpetual license cover releases up to its maintenance date.
 */
@Configuration
public class LicensingConfiguration implements WebMvcConfigurer {
    static final String PRODUCT = "certalert";

    private final ObjectProvider<LicenseManager> licenses;

    public LicensingConfiguration(ObjectProvider<LicenseManager> licenses) {
        this.licenses = licenses;
    }

    @Bean
    LicenseManager licenseManager(ObjectProvider<BuildProperties> build) {
        Optional<Instant> released = Optional.ofNullable(build.getIfAvailable()).map(BuildProperties::getTime);
        return LicenseManager.fromEnvironment(PRODUCT, LicenseVerifier.trusting(EnsKeys.PUBLIC_KEYS), released);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new LicenseInterceptor(licenses.getObject()))
                .excludePathPatterns("/login", "/logout", "/admin/license/**", "/css/**", "/js/**", "/img/**", "/actuator/**");
    }
}
