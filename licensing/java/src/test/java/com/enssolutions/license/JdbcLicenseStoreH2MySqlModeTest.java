package com.enssolutions.license;

import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;

/** {@link JdbcLicenseStoreContract} on H2 in MySQL mode, with the MySQL DDL. */
class JdbcLicenseStoreH2MySqlModeTest extends JdbcLicenseStoreContract {
    static DataSource dataSource;

    @BeforeAll
    static void createTables() throws Exception {
        dataSource = TestLicenses.dataSource("jdbc:h2:mem:ens-h2my;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
        TestLicenses.runDdl(dataSource, JdbcLicenseStore.Dialect.MYSQL.ddl());
    }

    @Override
    DataSource dataSource() {
        return dataSource;
    }
}
