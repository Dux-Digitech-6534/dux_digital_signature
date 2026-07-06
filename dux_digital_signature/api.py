import hashlib
import io
from html import escape
from urllib.parse import quote

import frappe
from frappe.utils import now


SIGNATURE_FIELDNAMES = (
	"custom_is_digitally_signed",
	"custom_signed_by",
	"custom_signed_by_user",
	"custom_signed_on",
	"custom_signature_designation",
	"custom_signature_text",
	"custom_signature_image",
	"custom_signature_hash",
	"custom_signature_qr_data",
)


def apply_digital_signature(doc, method=None):
	if doc.doctype in ("Digital Signature User", "Digital Signature Setup"):
		return

	if getattr(doc, "custom_is_digitally_signed", 0):
		return

	for setup in _get_enabled_setups(doc.doctype):
		if not _has_signature_fields(doc):
			frappe.log_error(
				title="Digital Signature fields missing",
				message=f"Create signature fields for {doc.doctype} before applying digital signatures.",
			)
			continue

		if not _should_apply_signature(doc, setup, method):
			continue

		if _apply_signature_from_setup(doc, setup, method):
			break


def _get_enabled_setups(doctype):
	if not _doctype_table_exists("Digital Signature Setup"):
		return []

	return frappe.get_all(
		"Digital Signature Setup",
		filters={"enabled": 1, "document_type": doctype},
		fields=["name", "signature_trigger", "final_approval_state", "signer", "fixed_user", "signer_name"],
		order_by="modified desc",
	)


def _doctype_table_exists(doctype):
	try:
		return frappe.db.table_exists(doctype)
	except Exception:
		return bool(frappe.db.exists("DocType", doctype))


def _has_signature_fields(doc):
	meta_fieldnames = {field.fieldname for field in doc.meta.fields}
	return all(fieldname in meta_fieldnames for fieldname in SIGNATURE_FIELDNAMES)


def _should_apply_signature(doc, setup, method):
	if setup.signature_trigger == "On Submit":
		return method == "before_submit" and doc.docstatus == 1

	return False


def _apply_signature_from_setup(doc, setup, method):
	signer = _resolve_signer_for_setup(setup)
	if not signer:
		return False

	profile = _get_signer_profile(signer, setup)
	if not profile:
		return False

	signed_on = now()
	hash_value = _build_hash(doc, signer, profile["full_name"], signed_on)
	qr_data = _build_qr_data(doc, profile["full_name"], signed_on, hash_value)

	values = {
		"custom_is_digitally_signed": 1,
		"custom_signed_by": profile["full_name"],
		"custom_signed_by_user": signer,
		"custom_signed_on": signed_on,
		"custom_signature_designation": profile["designation"],
		"custom_signature_text": profile["signature_text"],
		"custom_signature_image": profile["signature_image"],
		"custom_signature_hash": hash_value,
		"custom_signature_qr_data": qr_data,
	}

	if method == "on_update":
		for fieldname, value in values.items():
			doc.db_set(fieldname, value, update_modified=False)
	else:
		for fieldname, value in values.items():
			doc.set(fieldname, value)

	return True


def _resolve_signer_for_setup(setup):
	submitting_user = frappe.session.user
	if not submitting_user or submitting_user == "Guest":
		return None

	if setup.signer == "User" and setup.signer_name:
		return submitting_user

	if setup.fixed_user and setup.fixed_user == submitting_user:
		return submitting_user

	return None


def _get_signer_profile(signer, setup=None):
	if setup and setup.signer == "User" and setup.signer_name:
		full_name = setup.signer_name.strip()
		if not full_name:
			return None
		return {
			"full_name": full_name,
			"designation": "",
			"signature_text": f"Digitally signed by {full_name}",
			"signature_image": "",
		}

	profile_name = frappe.db.get_value(
		"Digital Signature User",
		{"user": signer, "is_active": 1},
		"name",
	)

	if not profile_name:
		return None

	profile = frappe.get_doc("Digital Signature User", profile_name)
	full_name = profile.full_name or frappe.db.get_value("User", signer, "full_name") or signer
	return {
		"full_name": full_name,
		"designation": profile.designation or "",
		"signature_text": profile.signature_text or f"Digitally signed by {full_name}",
		"signature_image": profile.signature_image or "",
	}


def _build_hash(doc, signer, full_name, signed_on):
	hash_data = "\n".join(
		[
			f"doctype={doc.doctype}",
			f"name={doc.name}",
			f"signed_by_user={signer}",
			f"signed_by_name={full_name}",
			f"signed_on={signed_on}",
			f"workflow_state={getattr(doc, 'workflow_state', '') or ''}",
			f"docstatus={doc.docstatus}",
		]
	)
	return hashlib.sha256(hash_data.encode("utf-8")).hexdigest()


def _build_qr_data(doc, full_name, signed_on, hash_value):
	return "\n".join(
		[
			f"Doctype: {doc.doctype}",
			f"Document: {doc.name}",
			f"Signed By: {full_name}",
			f"Signed On: {signed_on}",
			f"Hash: {hash_value}",
		]
	)


@frappe.whitelist()
def get_signature_html(doctype, name):
	doc = frappe.get_doc(doctype, name)
	if not getattr(doc, "custom_is_digitally_signed", 0):
		return ""

	signature_image = getattr(doc, "custom_signature_image", None)
	signed_by = getattr(doc, "custom_signed_by", None) or ""
	qr_src = (
		"/api/method/dux_digital_signature.api.get_signature_qr_svg"
		f"?doctype={quote(str(doctype))}&name={quote(str(name))}"
	)

	visual_html = (
		f"<img src='{escape(qr_src)}' style='width:78px;height:78px;object-fit:contain;' />"
	)
	if signature_image:
		visual_html += (
			"<div style='margin-top:4px;'>"
			f"<img src='{escape(str(signature_image))}' style='max-height:28px;max-width:78px;object-fit:contain;' />"
			"</div>"
		)

	lines = [
		"<div class='digital-signature-box' style='width:360px;margin:10px 0 0 auto;border:1px solid #d8e6dc;border-left:4px solid #2f9e44;background:#fbfffc;padding:8px 10px;font-size:10px;line-height:1.25;color:#4b5563;'>",
		"<div style='display:flex;gap:10px;align-items:flex-start;'>",
		f"<div style='width:82px;flex:0 0 82px;text-align:center;'>{visual_html}</div>",
		"<div style='flex:1;min-width:0;'>",
		"<div style='font-weight:700;color:#2f9e44;letter-spacing:.5px;margin-bottom:3px;'>&#10003; DIGITALLY SIGNED</div>",
		f"<div style='font-size:13px;font-weight:700;color:#111827;'>{escape(str(signed_by))}</div>",
		f"<div><b>Designation:</b> {escape(str(getattr(doc, 'custom_signature_designation', None) or ''))}</div>",
		f"<div><b>Date:</b> {escape(str(getattr(doc, 'custom_signed_on', None) or ''))}</div>",
		f"<div><b>Document:</b> {escape(str(doc.name or ''))}</div>",
		f"<div style='word-break:break-all;'><b>SHA-256:</b> {escape(str(getattr(doc, 'custom_signature_hash', None) or ''))}</div>",
		"</div>",
		"</div>",
		"<div style='margin-top:6px;color:#9ca3af;font-size:9px;'>Electronically signed by the authorised signatory. Authenticity can be verified against the SHA-256 digest encoded in the QR.</div>",
		"</div>",
	]
	return "".join(lines)


@frappe.whitelist(allow_guest=True)
def get_signature_qr_svg(doctype, name):
	signature = _get_signature_values(doctype, name)
	if not signature or not signature.get("custom_is_digitally_signed"):
		frappe.throw("Document is not digitally signed.")

	qr_data = signature.get("custom_signature_qr_data") or signature.get("custom_signature_hash") or name

	import pyqrcode

	buffer = io.BytesIO()
	pyqrcode.create(qr_data, error="M").svg(buffer, scale=3, quiet_zone=1)

	frappe.local.response["type"] = "download"
	frappe.local.response["filename"] = f"{name}-digital-signature-qr.svg"
	frappe.local.response["filecontent"] = buffer.getvalue()
	frappe.local.response["content_type"] = "image/svg+xml"
	frappe.local.response["display_content_as"] = "inline"


def _get_signature_values(doctype, name):
	if not frappe.db.exists("DocType", doctype):
		return None

	meta = frappe.get_meta(doctype)
	fieldnames = {field.fieldname for field in meta.fields}
	required_fields = {
		"custom_is_digitally_signed",
		"custom_signature_qr_data",
		"custom_signature_hash",
	}
	if not required_fields.issubset(fieldnames):
		return None

	return frappe.db.get_value(
		doctype,
		name,
		["custom_is_digitally_signed", "custom_signature_qr_data", "custom_signature_hash"],
		as_dict=True,
	)


@frappe.whitelist()
def get_user_details(user):
	if not user:
		return {}

	full_name = frappe.db.get_value("User", user, "full_name") or user
	designation = ""

	try:
		if frappe.db.exists("DocType", "Employee"):
			employee = frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, ["designation"], as_dict=True)
			designation = (employee or {}).get("designation") or ""
	except Exception:
		designation = ""

	return {
		"full_name": full_name,
		"designation": designation,
		"signature_text": f"Digitally signed by {full_name}",
	}
