frappe.ui.form.on("Digital Signature User", {
	user(frm) {
		if (!frm.doc.user) {
			return;
		}

		frappe.db.get_value("User", frm.doc.user, "full_name").then((r) => {
			const full_name = (r.message && r.message.full_name) || frm.doc.user;

			if (!frm.doc.full_name) {
				frm.set_value("full_name", full_name);
			}

			if (!frm.doc.signature_text) {
				frm.set_value("signature_text", `Digitally signed by ${full_name}`);
			}
		});

		frappe.db.get_value("Employee", { user_id: frm.doc.user, status: "Active" }, "designation").then((r) => {
			const designation = r.message && r.message.designation;
			if (designation && !frm.doc.designation) {
				frm.set_value("designation", designation);
			}
		});
	},
});
