package com.enssolutions.certalert.licensing;

import com.enssolutions.license.LicenseCheck;
import com.enssolutions.license.LicenseException;
import com.enssolutions.license.LicenseManager;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

/**
 * The application's license screen: what is installed, this installation's
 * id (for binding), and an upload form. Administrators only.
 */
@Controller
@RequestMapping("/admin/license")
@PreAuthorize("hasRole('ADMIN')")
public class LicenseController {
    private final LicenseManager licenses;

    public LicenseController(LicenseManager licenses) {
        this.licenses = licenses;
    }

    @GetMapping
    String show(Model model) {
        model.addAttribute("check", licenses.current());
        model.addAttribute("installationId", licenses.installationId());
        model.addAttribute("licenseFile", licenses.licenseFile());
        return "admin/license";
    }

    @PostMapping
    String upload(@RequestParam("file") MultipartFile file, RedirectAttributes flash) throws IOException {
        if (file.getSize() > 64 * 1024) {
            flash.addFlashAttribute("error", "That file is too large to be a license.");
            return "redirect:/admin/license";
        }
        try {
            LicenseCheck check = licenses.install(new String(file.getBytes(), StandardCharsets.UTF_8));
            flash.addFlashAttribute(check.isFullyLicensed() ? "notice" : "error", check.message());
        } catch (LicenseException e) {
            flash.addFlashAttribute("error", "That isn't a valid ENS license: " + e.getMessage() + ".");
        }
        return "redirect:/admin/license";
    }
}
