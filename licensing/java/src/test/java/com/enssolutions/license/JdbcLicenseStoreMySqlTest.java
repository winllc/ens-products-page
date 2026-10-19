package com.enssolutions.license;

import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.testcontainers.mysql.MySQLContainer;

/** {@link JdbcLicenseStoreContract} on MySQL 8.4 (Testcontainers), with the MySQL DDL. */
class JdbcLicenseStoreMySqlTest extends JdbcLicenseStoreContract {
    static MySQLContainer db;
    static DataSource dataSource;

    @BeforeAll
    static void start() throws Exception {
        Databases.requireDocker();
        db = new MySQLContainer("mysql:8.4");
        db.start();
        dataSource = TestLicenses.dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        TestLicenses.runDdl(dataSource, JdbcLicenseStore.Dialect.MYSQL.ddl());
    }

    @AfterAll
    static void stop() {
        if (db != null) db.stop();
    }

    @Override
    DataSource dataSource() {
        return dataSource;
    }
}
