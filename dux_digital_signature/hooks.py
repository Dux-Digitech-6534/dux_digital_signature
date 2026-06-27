app_name = "dux_digital_signature"
app_title = "Dux Digital Signature"
app_publisher = "Dux Digitech"
app_description = "Reusable text-based digital signature support for Frappe and ERPNext documents"
app_email = "support@duxdigitech.com"
app_license = "MIT"

doc_events = {
	"*": {
		"before_submit": "dux_digital_signature.api.apply_digital_signature",
		"on_update": "dux_digital_signature.api.apply_digital_signature",
	}
}
