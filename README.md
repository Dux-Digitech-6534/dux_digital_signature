# Dux Digital Signature

Reusable digital signature support for Frappe and ERPNext documents.

Add this line to a print format to render the stored signature:

```jinja
{{ frappe.get_attr("dux_digital_signature.api.get_signature_html")(doc.doctype, doc.name) }}
```
