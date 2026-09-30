/*
 * Contact form.
 *
 * The site has no backend, so the form does not post anywhere. On submit this
 * composes a mailto: link from the fields and hands it to the visitor's own
 * email app, which is where the message is actually sent from.
 *
 * Without this script the form still works through the browser's native
 * mailto form submission, just less tidily formatted.
 */
(function () {
    "use strict";

    var form = document.getElementById("contact-form");
    if (!form) {
        return;
    }

    var status = document.getElementById("form-status");
    var recipient = form.getAttribute("data-recipient");

    // ?product=readyroom (etc.) from a product page pre-selects the topic.
    var topics = {
        readyroom: "ReadyRoom",
        certalert: "CertAlert",
        "mfa-portal": "MFA Portal",
        "directory-portal": "Directory Services Portal"
    };
    var product = new URLSearchParams(window.location.search).get("product");
    if (product && Object.prototype.hasOwnProperty.call(topics, product)) {
        form.elements.topic.value = topics[product];
    }

    function field(name) {
        return form.elements[name].value.trim();
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        var name = field("name");
        var organization = field("organization");
        var topic = field("topic");

        var subject = topic + " — website inquiry from " + name + (organization ? " (" + organization + ")" : "");

        var lines = [
            "Name: " + name,
            "Email: " + field("email")
        ];
        if (organization) {
            lines.push("Organization: " + organization);
        }
        if (field("phone")) {
            lines.push("Phone: " + field("phone"));
        }
        lines.push("Topic: " + topic, "", field("message"));

        // mailto bodies need CRLF line breaks to survive every mail client,
        // including the ones typed inside the message itself.
        var body = lines.join("\n").replace(/\r?\n/g, "\r\n");
        var href = "mailto:" + recipient +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(body);

        window.location.href = href;

        status.textContent = "Your email app should open with the message ready to send. " +
            "If nothing happened, email " + recipient + " directly.";
        status.hidden = false;
    });
})();
