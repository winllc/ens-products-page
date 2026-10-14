package com.enssolutions.certalert.licensing;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a controller or handler method as part of a licensed feature, by its
 * id in the site's src/data/licensing.ts ("revocation-checks"). Requests to it
 * get 403 unless the installed license unlocks that feature.
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresFeature {
    String value();
}
