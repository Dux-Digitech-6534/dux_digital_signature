frappe.ui.form.on("Digital Signature Setup", {
	setup(frm) {
		frm.set_query("print_format", () => {
			return {
				filters: {
					doc_type: frm.doc.document_type || "",
				},
			};
		});
	},

	document_type(frm) {
		frm.set_value("print_format", "");
	},

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

	add_signature_to_print_format(frm) {
		if (frm.is_new()) {
			frappe.msgprint(__("Please save this setup before updating a print format."));
			return;
		}

		if (!frm.doc.print_format) {
			frappe.msgprint(__("Please select a Print Format first."));
			return;
		}

		frm.call("add_signature_to_print_format").then((r) => {
			if (r.message) {
				frappe.msgprint(r.message);
			}
		});
	},
});
