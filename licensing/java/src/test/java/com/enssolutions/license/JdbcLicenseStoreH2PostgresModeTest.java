package com.enssolutions.license;

import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;

/** {@link JdbcLicenseStoreContract} on H2 in PostgreSQL mode, with the PostgreSQL DDL. */
class JdbcLicenseStoreH2PostgresModeTest extends JdbcLicenseStoreContract {
    static DataSource dataSource;

    @BeforeAll
    static void createTables() throws Exception {
        dataSource = TestLicenses.dataSource("jdbc:h2:mem:ens-h2pg;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        TestLicenses.runDdl(dataSource, JdbcLicenseStore.Dialect.POSTGRESQL.ddl());
    }

    @Override
    DataSource dataSource() {
        return dataSource;
    }
}
