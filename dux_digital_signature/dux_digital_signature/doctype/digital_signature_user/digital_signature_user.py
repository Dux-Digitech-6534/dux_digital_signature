import frappe
from frappe.model.document import Document


class DigitalSignatureUser(Document):
	def validate(self):
		if not self.signature_text and self.full_name:
			self.signature_text = f"Digitally signed by {self.full_name}"

		if not self.full_name and self.user:
			self.full_name = frappe.db.get_value("User", self.user, "full_name") or self.user
