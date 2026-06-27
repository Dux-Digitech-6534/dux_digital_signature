import frappe
from frappe.model.document import Document
from frappe.utils import now


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
