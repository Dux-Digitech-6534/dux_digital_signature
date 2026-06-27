frappe.ui.form.on("Digital Signature User", {
	user(frm) {
		if (!frm.doc.user) {
			return;
		}

		frappe.call({
			method: "dux_digital_signature.api.get_user_details",
			args: {
				user: frm.doc.user,
			},
			callback(r) {
				const details = r.message || {};

				if (details.full_name && !frm.doc.full_name) {
					frm.set_value("full_name", details.full_name);
				}

				if (details.designation && !frm.doc.designation) {
					frm.set_value("designation", details.designation);
				}

				if (details.signature_text && !frm.doc.signature_text) {
					frm.set_value("signature_text", details.signature_text);
				}
			},
		});
	},
});
