package com.enssolutions.certalert.licensing;

import com.enssolutions.license.LicenseCheck;
import com.enssolutions.license.LicenseManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Guards for scheduled work and limits, called from the jobs themselves:
 *
 * <pre>
 * &#64;Scheduled(cron = "...")
 * void revocationSweep() {
 *     if (!jobs.mayRun("revocation-checks")) return;
 *     ...
 * }
 *
 * // in the directory sync, before adding a person:
 * if (!jobs.mayAdd(peopleRepository.count())) { skip, and keep the count for the report }
 * </pre>
 */
@Component
public class LicensedJobs {
    private static final Logger log = LoggerFactory.getLogger(LicensedJobs.class);

    private final LicenseManager licenses;

    public LicensedJobs(LicenseManager licenses) {
        this.licenses = licenses;
    }

    /** Scheduled jobs pause unless the license is in full effect and unlocks the feature. */
    public boolean mayRun(String feature) {
        LicenseCheck check = licenses.current();
        if (!check.isFeatureEnabled(feature)) {
            log.info("Skipping {}: {}", feature, check.isFullyLicensed() ? "not included in the license" : check.message());
            return false;
        }
        return true;
    }

    /** Whether one more person, server or token may be added to the current count. */
    public boolean mayAdd(long currentCount) {
        LicenseCheck check = licenses.current();
        boolean ok = check.mayAdd(currentCount);
        if (!ok) log.warn("License limit: {}", check.usageMessage(currentCount + 1));
        return ok;
    }
}
