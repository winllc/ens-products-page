package com.enssolutions.license;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import java.util.Optional;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** {@link JdbcLicenseStoreContract} on H2, native mode. */
class JdbcLicenseStoreH2Test extends JdbcLicenseStoreContract {
    static DataSource dataSource;

    @BeforeAll
    static void createTables() throws Exception {
        dataSource = TestLicenses.dataSource("jdbc:h2:mem:ens-h2;DB_CLOSE_DELAY=-1", "sa", "");
        TestLicenses.runDdl(dataSource, JdbcLicenseStore.Dialect.H2.ddl());
    }

    @Override
    DataSource dataSource() {
        return dataSource;
    }

    /** Tables made for 1.2.0, without latest_seen_ms: everything works, against the clock alone. */
    @Test
    void tablesWithoutTheLatestTimeSeenStillWork() throws Exception {
        DataSource old = TestLicenses.dataSource("jdbc:h2:mem:ens-h2-120;DB_CLOSE_DELAY=-1", "sa", "");
        String ddl = JdbcLicenseStore.Dialect.H2.ddl();
        String without = ddl.replace(",\n    latest_seen_ms   BIGINT", "");
        assertNotEquals(ddl, without);
        TestLicenses.runDdl(old, without);
        LicenseManager m = new LicenseManager("certalert", TestLicenses.verifier(), new JdbcLicenseStore(old, "certalert", Duration.ZERO),
                Optional.empty(), CLOCK, Optional.empty());
        assertEquals(LicenseState.VALID, m.install(TestLicenses.license("lic_120", 1, null)).state());
        assertEquals(LicenseState.VALID, m.current().state());
    }
}
