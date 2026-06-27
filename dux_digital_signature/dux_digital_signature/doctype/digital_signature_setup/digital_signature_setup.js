frappe.ui.form.on("Digital Signature Setup", {
	auto_create_fields(frm) {
		if (frm.is_new()) {
			frappe.msgprint(__("Please save this setup before creating signature fields."));
			return;
		}

		frm.call("create_signature_fields").then((r) => {
			if (r.message) {
				frappe.msgprint(r.message);
			}
			frm.reload_doc();
		});
	},
});
