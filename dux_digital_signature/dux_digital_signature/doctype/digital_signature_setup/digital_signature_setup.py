import frappe
from frappe.model.document import Document
from frappe.utils import now


SIGNATURE_PRINT_BLOCK = """{% if doc.custom_is_digitally_signed %}
<div class="digital-signature-card" style="width:360px;margin:10px 0 0 auto;border:1px solid #d8e6dc;border-left:4px solid #2f9e44;background:#fbfffc;padding:8px 10px;font-size:10px;line-height:1.25;color:#4b5563;">
    <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="width:82px;flex:0 0 82px;text-align:center;">
            <img src="/api/method/dux_digital_signature.api.get_signature_qr_svg?doctype={{ doc.doctype }}&name={{ doc.name }}" style="width:78px;height:78px;object-fit:contain;">
            {% if doc.custom_signature_image %}
            <div style="margin-top:4px;">
                <img src="{{ doc.custom_signature_image }}" style="max-height:28px;max-width:78px;object-fit:contain;">
            </div>
            {% endif %}
        </div>
        <div style="flex:1;min-width:0;text-align:right;">
            <div style="font-weight:700;color:#2f9e44;letter-spacing:.5px;margin-bottom:3px;">&#10003; DIGITALLY SIGNED</div>
            <div style="font-size:13px;font-weight:700;color:#111827;">{{ doc.custom_signed_by or "" }}</div>
            <div>{{ doc.custom_signature_designation or "" }}</div>
            <div><b>Date:</b> {{ doc.custom_signed_on or "" }}</div>
            <div><b>Document:</b> {{ doc.name }}</div>
            <div style="word-break:break-all;"><b>SHA-256:</b> {{ doc.custom_signature_hash or "" }}</div>
        </div>
    </div>
    <div style="margin-top:6px;color:#9ca3af;font-size:9px;text-align:center;">
        Electronically signed by the authorised signatory. Authenticity can be verified against the SHA-256 digest encoded in the QR.
    </div>
</div>
{% endif %}"""


SIGNATURE_FIELDS = [
	{
		"fieldname": "custom_is_digitally_signed",
		"label": "Is Digitally Signed",
		"fieldtype": "Check",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signed_by",
		"label": "Signed By",
		"fieldtype": "Data",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signed_by_user",
		"label": "Signed By User",
		"fieldtype": "Link",
		"options": "User",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signed_on",
		"label": "Signed On",
		"fieldtype": "Datetime",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signature_designation",
		"label": "Signature Designation",
		"fieldtype": "Data",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signature_text",
		"label": "Signature Text",
		"fieldtype": "Small Text",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signature_image",
		"label": "Signature Image",
		"fieldtype": "Attach Image",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signature_hash",
		"label": "Signature Hash",
		"fieldtype": "Small Text",
		"hidden": 0,
		"read_only": 1,
	},
	{
		"fieldname": "custom_signature_qr_data",
		"label": "Signature QR Data",
		"fieldtype": "Long Text",
		"hidden": 0,
		"read_only": 1,
	},
]


class DigitalSignatureSetup(Document):
	def validate(self):
		if self.signature_trigger == "On Final Approval" and not self.final_approval_state:
			frappe.throw("Final Approval State is required when Signature Trigger is On Final Approval.")

		if self.signer == "Fixed User" and not self.fixed_user:
			frappe.throw("Fixed User is required when Signer is Fixed User.")

	@frappe.whitelist()
	def create_signature_fields(self):
		if not self.document_type:
			frappe.throw("Please select a Document Type first.")

		created_fields = create_signature_fields_for_doctype(self.document_type)
		self.db_set("is_setup_completed", 1, update_modified=False)
		self.db_set("last_setup_on", now(), update_modified=False)
		frappe.clear_cache(doctype=self.document_type)

		if created_fields:
			return "Created signature fields: {0}".format(", ".join(created_fields))

		return "All signature fields already exist for {0}.".format(self.document_type)

	@frappe.whitelist()
	def add_signature_to_print_format(self):
		if not self.document_type:
			frappe.throw("Please select a Document Type first.")

		if not self.print_format:
			frappe.throw("Please select a Print Format first.")

		print_format = frappe.get_doc("Print Format", self.print_format)
		if print_format.doc_type != self.document_type:
			frappe.throw("Selected Print Format does not belong to {0}.".format(self.document_type))

		if print_format.standard == "Yes":
			frappe.throw("Standard Print Format cannot be edited. Please duplicate it and select the custom copy.")

		if "dux_digital_signature.api.get_signature_qr_svg" in (print_format.html or ""):
			return "Digital signature block already exists in {0}.".format(print_format.name)

		_create_print_format_backup(print_format)
		print_format.html = _insert_signature_block(print_format.html or "")
		print_format.save(ignore_permissions=True)
		frappe.db.commit()

		return "Digital signature block added to {0}.".format(print_format.name)


def create_signature_fields_for_doctype(doctype):
	meta = frappe.get_meta(doctype)
	existing_fields = {field.fieldname for field in meta.fields}
	created_fields = []
	insert_after = meta.fields[-1].fieldname if meta.fields else None

	for field in SIGNATURE_FIELDS:
		if field["fieldname"] in existing_fields:
			_update_existing_custom_field(doctype, field)
			continue

		custom_field = frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": doctype,
				"insert_after": insert_after,
				**field,
			}
		)
		custom_field.insert(ignore_permissions=True)
		created_fields.append(field["fieldname"])
		insert_after = field["fieldname"]

	frappe.db.commit()
	frappe.clear_cache(doctype=doctype)
	return created_fields


def _update_existing_custom_field(doctype, field):
	custom_field_name = frappe.db.get_value(
		"Custom Field",
		{"dt": doctype, "fieldname": field["fieldname"]},
		"name",
	)
	if not custom_field_name:
		return

	custom_field = frappe.get_doc("Custom Field", custom_field_name)
	updated = False

	for property_name in ("hidden", "read_only", "label", "fieldtype", "options"):
		if property_name not in field:
			continue

		if custom_field.get(property_name) != field[property_name]:
			custom_field.set(property_name, field[property_name])
			updated = True

	if updated:
		custom_field.save(ignore_permissions=True)


def _create_print_format_backup(print_format):
	backup_name = "{0} Backup Before Digital Signature".format(print_format.name)
	if frappe.db.exists("Print Format", backup_name):
		return

	backup = frappe.copy_doc(print_format)
	backup.name = backup_name
	backup.print_format_name = backup_name
	backup.disabled = 1
	backup.insert(ignore_permissions=True)


def _insert_signature_block(html):
	marker = "Authorized Signature"
	marker_index = html.find(marker)
	if marker_index == -1:
		return "{0}\n\n{1}\n".format(html.rstrip(), SIGNATURE_PRINT_BLOCK)

	insert_index = html.find("</table>", marker_index)
	if insert_index != -1:
		insert_index += len("</table>")
	else:
		insert_index = html.find("</div>", marker_index)
		if insert_index != -1:
			insert_index += len("</div>")
		else:
			line_end = html.find("\n", marker_index)
			insert_index = line_end if line_end != -1 else len(html)

	return "{0}\n\n{1}\n\n{2}".format(
		html[:insert_index].rstrip(),
		SIGNATURE_PRINT_BLOCK,
		html[insert_index:].lstrip(),
	)
