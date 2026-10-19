package com.enssolutions.certalert.licensing;

import com.enssolutions.license.LicenseManager;
import com.enssolutions.license.LicenseVerifier;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;
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
 *
 * <p>The license state (installation id, license, revisions) is kept in the
 * application's database, so any number of replicas share one installation;
 * the tables come from the Flyway migration in licensing/README.md ("Several
 * replicas"). On its first start against an empty table it adopts the id and
 * license from ENS_LICENSE_STATE_DIR and ENS_LICENSE_FILE, so an upgraded
 * installation keeps its id. For a single replica on a volume instead, use
 * {@code LicenseManager.fromEnvironment(PRODUCT, verifier, released)}.
 */
@Configuration
public class LicensingConfiguration implements WebMvcConfigurer {
    static final String PRODUCT = "certalert";

    private final ObjectProvider<LicenseManager> licenses;

    public LicensingConfiguration(ObjectProvider<LicenseManager> licenses) {
        this.licenses = licenses;
    }

    @Bean
    LicenseManager licenseManager(ObjectProvider<BuildProperties> build, DataSource dataSource) {
        Optional<Instant> released = Optional.ofNullable(build.getIfAvailable()).map(BuildProperties::getTime);
        return LicenseManager.fromEnvironment(PRODUCT, LicenseVerifier.trusting(EnsKeys.PUBLIC_KEYS), released, dataSource);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new LicenseInterceptor(licenses.getObject()))
                .excludePathPatterns("/login", "/logout", "/admin/license/**", "/css/**", "/js/**", "/img/**", "/actuator/**");
    }
}
