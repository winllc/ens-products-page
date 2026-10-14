package com.enssolutions.certalert.licensing;

import com.enssolutions.license.LicenseCheck;
import com.enssolutions.license.LicenseManager;
import com.enssolutions.license.LicenseState;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Applies the license to every request:
 * <ul>
 *   <li>UNLICENSED: everything except sign-in and the license screen redirects there.</li>
 *   <li>READ_ONLY: GET and HEAD work; anything that would change data gets 403.</li>
 *   <li>{@link RequiresFeature}: 403 unless the license unlocks that feature.</li>
 * </ul>
 * The check is exposed to views as the "license" request attribute, for the
 * evaluation banner and the renewal warning.
 */
public class LicenseInterceptor implements HandlerInterceptor {
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS");

    private final LicenseManager licenses;

    public LicenseInterceptor(LicenseManager licenses) {
        this.licenses = licenses;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        LicenseCheck check = licenses.current();
        request.setAttribute("license", check);

        if (check.mode() == LicenseState.Mode.UNLICENSED) {
            response.sendRedirect(request.getContextPath() + "/admin/license");
            return false;
        }
        if (check.mode() == LicenseState.Mode.READ_ONLY && !SAFE.contains(request.getMethod())) {
            response.sendError(HttpServletResponse.SC_FORBIDDEN, check.message());
            return false;
        }
        if (handler instanceof HandlerMethod method) {
            RequiresFeature feature = method.getMethodAnnotation(RequiresFeature.class);
            if (feature == null) feature = method.getBeanType().getAnnotation(RequiresFeature.class);
            if (feature != null && !check.isFeatureEnabled(feature.value())) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN, "Your license doesn't include this feature.");
                return false;
            }
        }
        return true;
    }
}
