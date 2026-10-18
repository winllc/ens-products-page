package com.enssolutions.license;

import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;

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
}
