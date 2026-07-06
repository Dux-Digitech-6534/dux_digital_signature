# Dux Digital Signature Documentation

Generated from read-only review on 2026-07-06.

Server reviewed: `dux@147.93.106.128`  
Bench: `/home/dux/frappe-bench`  
App path: `/home/dux/frappe-bench/apps/dux_digital_signature`  
Site checked: `app.duxdigitech.in`  
Branch observed: `master`  
Installed on site: Yes, `dux_digital_signature 0.0.1 master`

## 1. App Overview

`dux_digital_signature` is a Frappe app for adding reusable text/image based digital signature metadata to any configured DocType.

Main capabilities:
- Maintain signer profiles in `Digital Signature User`.
- Configure document signing rules in `Digital Signature Setup`.
- Create required custom signature fields on target DocTypes.
- Apply signature metadata when a configured document is submitted.
- Store signer name, user, date, designation, signature text, image path, SHA-256 hash, and QR payload as document fields.
- Render a compact digital signature HTML block for print formats.
- Generate QR SVG dynamically from stored QR data.
- Add a QR signature block into a selected/custom print format.
- Provide a custom management page at `/app/dux-digital-signature` / `/desk/dux-digital-signature`.

## 2. Main DocTypes and Fields

### Digital Signature User

Path:
`dux_digital_signature/dux_digital_signature/doctype/digital_signature_user/`

Purpose:
Stores signer profile data mapped to a Frappe `User`.

Fields:
- `user`: Link to `User`, required, unique, autoname source.
- `full_name`: Data, required.
- `designation`: Data.
- `signature_text`: Small Text.
- `signature_image`: Attach Image, currently hidden.
- `signature_image_data`: Long Text.
- `is_active`: Check, default `1`.

Python logic:
- `validate()` fills `signature_text` as `Digitally signed by {full_name}` if blank.
- `validate()` fills `full_name` from linked `User.full_name` if blank.

Client logic:
- On `user` selection, fetches `User.full_name`.
- Fetches active `Employee.designation` by `user_id`.
- Auto-fills `full_name`, `signature_text`, and `designation` when available.

### Digital Signature Setup

Path:
`dux_digital_signature/dux_digital_signature/doctype/digital_signature_setup/`

Purpose:
Stores signing configuration for one target document type.

Fields:
- `enabled`: Check, default `1`.
- `document_type`: Link to `DocType`, required.
- `signature_trigger`: Select, currently only `On Submit`.
- `final_approval_state`: Data, hidden. Present but not active in current logic.
- `signer`: Select, `Fixed User` or `User`, required.
- `fixed_user`: Link to `User`, shown/required when signer is `Fixed User`.
- `signer_name`: Data, shown/required when signer is `User`.
- `auto_create_fields`: Button, calls `create_signature_fields`.
- `print_format`: Link to `Print Format`, filtered by selected `document_type`.
- `print_format_update_mode`: Select, hidden, default `Update Selected Print Format`.
- `signature_placement`: Select, hidden, default `Default Signature Block`.
- `add_signature_to_print_format`: Button, calls `add_signature_to_print_format`.
- `is_setup_completed`: Check, read only.
- `last_setup_on`: Datetime, read only.

Python validation:
- Forces `signature_trigger = "On Submit"`.
- Clears `final_approval_state`.
- Forces `signature_placement = "Default Signature Block"`.
- Requires `fixed_user` when signer is `Fixed User`.
- Requires `signer_name` when signer is `User`.
- Clears `fixed_user` when signer is `User`.

## 3. Custom Fields Created on Standard DocTypes

`Digital Signature Setup.create_signature_fields()` creates/updates these fields on the selected target DocType:

- `custom_is_digitally_signed`: Check, hidden, print hidden, read only.
- `custom_signed_by`: Data, hidden, print hidden, read only.
- `custom_signed_by_user`: Link to `User`, hidden, print hidden, read only.
- `custom_signed_on`: Datetime, hidden, print hidden, read only.
- `custom_signature_designation`: Data, hidden, print hidden, read only.
- `custom_signature_text`: Small Text, hidden, print hidden, read only.
- `custom_signature_image`: Attach Image, hidden, print hidden, read only.
- `custom_signature_hash`: Small Text, hidden, print hidden, read only.
- `custom_signature_qr_data`: Long Text, hidden, print hidden, read only.

Existing custom fields are updated for:
- `hidden`
- `print_hide`
- `read_only`
- `label`
- `fieldtype`
- `options`

Field values are stored on the target document during signing. No new `File` attachment is created by the signing flow; `custom_signature_image` stores the existing image path/reference from `Digital Signature User`.

## 4. Hooks and When They Run

File:
`dux_digital_signature/hooks.py`

Configured hooks:

```python
doc_events = {
    "*": {
        "before_submit": "dux_digital_signature.api.apply_digital_signature",
        "on_update": "dux_digital_signature.api.apply_digital_signature",
    }
}
```

Behavior:
- Runs for every DocType.
- Skips `Digital Signature User` and `Digital Signature Setup`.
- Skips already signed documents.
- Looks for enabled setup rows matching the document's DocType.
- Applies signature only when rules match.

Current trigger support:
- `On Submit`: implemented through `before_submit` with `doc.docstatus == 1`.
- `On Final Approval`: not implemented in current API logic. Needs verification if planned.

## 5. Whitelisted APIs and Purpose

File:
`dux_digital_signature/api.py`

### `apply_digital_signature(doc, method=None)`

Hook target. Applies signature metadata to configured target documents.

### `get_signature_html(doctype, name)`

Whitelisted print helper.

Usage in print format:

```jinja
{{ frappe.get_attr("dux_digital_signature.api.get_signature_html")(doc.doctype, doc.name) }}
```

Returns a compact HTML block when the document is signed. It includes:
- QR image from `get_signature_qr_svg`
- Signature image if available
- Signed by name
- Designation
- Date
- Document name
- SHA-256 hash

Returns empty string if document is not digitally signed.

### `get_signature_qr_svg(doctype, name)`

Whitelisted with `allow_guest=True`.

Generates an SVG QR code using `PyQRCode` from:
- `custom_signature_qr_data`, or
- `custom_signature_hash`, or
- document name as fallback.

Returns inline SVG content.

### `get_user_details(user)`

Whitelisted helper for UI.

Returns:
- `full_name`
- `designation`
- `signature_text`

Designation is fetched from active `Employee` by `user_id` if Employee DocType exists.

## 6. Signature Flow

### Signer Setup

1. Create `Digital Signature User`.
2. Select linked Frappe `User`.
3. App auto-fills full name from `User.full_name`.
4. App attempts to fetch designation from active `Employee`.
5. `signature_text` defaults to `Digitally signed by {full_name}`.
6. Optional `signature_image` path can be stored.
7. `is_active` must be enabled for normal profile lookup.

### DocType Setup

1. Create `Digital Signature Setup`.
2. Select `document_type`.
3. Trigger is currently forced to `On Submit`.
4. Choose signer:
   - `Fixed User`: signing only happens when submitting user matches `fixed_user`.
   - `User`: stores a manual signer name in `signer_name`; resolved against current submitting user.
5. Click `Create Signature Fields`.
6. Optionally select `Print Format` and click `Add Signature To Print Format`.

### Submit Trigger

1. Frappe calls `apply_digital_signature` on `before_submit`.
2. App checks matching enabled `Digital Signature Setup`.
3. App confirms all required custom fields exist on target DocType.
4. App checks trigger: `On Submit`, method `before_submit`, and `docstatus == 1`.
5. App resolves signer and signer profile.
6. App builds SHA-256 hash.
7. App builds QR data text.
8. App sets custom signature fields on the document before submit.

### Workflow Approval Trigger

Current code does not implement final workflow approval signing. `final_approval_state` exists but validation clears it and `_should_apply_signature()` returns true only for `On Submit`.

Status: Needs verification / future implementation.

### Metadata Stored on Document

The app stores:
- signed flag
- signer display name
- signer user
- signed timestamp
- designation
- signature text
- signature image path/reference
- SHA-256 hash
- QR payload text

The hash input includes:
- doctype
- document name
- signed by user
- signed by name
- signed on timestamp
- workflow state
- docstatus

## 7. Print Format Logic

### Manual Jinja Helper

The safest print-format integration is:

```jinja
{% if doc.custom_is_digitally_signed %}
{{ frappe.get_attr("dux_digital_signature.api.get_signature_html")(doc.doctype, doc.name) }}
{% endif %}
```

### Add Signature To Print Format

Backend method:
`DigitalSignatureSetup.add_signature_to_print_format()`

Behavior:
- Requires `document_type`.
- Requires `print_format`.
- Verifies selected print format belongs to selected document type.
- If selected print format is standard (`standard == "Yes"`), app creates or reuses a custom copy named:
  `{Print Format Name} Digital Signature`
- If custom copy exists, app syncs fields from the standard print format.
- Creates disabled backup named:
  `{Print Format Name} Backup Before Digital Signature`
- Inserts `SIGNATURE_PRINT_BLOCK`.
- Saves print format and commits.

Block insertion:
- Looks for text marker `Authorized Signature`.
- If found, inserts after nearby `</table>` or `</div>`.
- If marker is not found, appends block at the end.

Existing-section helper functions exist:
- `_has_existing_signature_section()`
- `_insert_signature_values_into_existing_section()`

But current `add_signature_to_print_format()` always inserts the QR signature block. Existing-section placement is not active in the current method.

Current limitation with standard print format:
- Standard print formats are not edited directly.
- The app clones/creates a custom copy and updates that copy.
- User must select the custom copied print format in print view.

## 8. Permissions and Roles Used

DocType permissions:
- `Digital Signature User`: `System Manager` has create/read/write/delete/email/export/print/report/share.
- `Digital Signature Setup`: `System Manager` has create/read/write/delete/email/export/print/report/share.

Page permissions:
- Page `dux-digital-signature` is restricted to `System Manager`.

Runtime behavior:
- Hook runs as part of document submit/update flow.
- Custom field creation uses `ignore_permissions=True`.
- Print format update uses `ignore_permissions=True`.

## 9. Known Limitations and Risky Areas

- Hooks are registered for `*`, so `apply_digital_signature` runs for all DocTypes on `before_submit` and `on_update`.
- `on_update` hook is registered, but current `_should_apply_signature()` only supports `On Submit`; this extra hook may be unnecessary overhead.
- Workflow/final approval signing is not implemented even though fields exist.
- Existing print signature section logic exists but is not currently used by the print-format update method.
- Standard print formats are copied before editing; original print format will not show injected QR block.
- Generated custom fields are hidden and print hidden by default, so standard auto print layout will not show them.
- `signature_image` field is hidden in `Digital Signature User`.
- `get_signature_qr_svg` is `allow_guest=True`; it only returns data for signed documents and selected fields, but public accessibility should be reviewed.
- The app depends on `PyQRCode`.
- No automated tests were found.
- No patches are listed in `patches.txt`.
- No fixtures were found in the current app file list.
- No `install.py` was found in the current app file list.
- `git status` at bench level showed many unrelated dirty files outside this app; not modified by this documentation task.

## 10. Recommended Next Improvements

- Add explicit support for `On Final Approval` workflow signing or remove hidden fields until implemented.
- Add mode selection for:
  - QR block
  - existing signature section
  - standard printable fields
- Make custom field visibility/print visibility configurable per setup.
- Avoid global `*` hook overhead by narrowing logic where possible or optimizing setup lookup.
- Add tests for:
  - field creation
  - submit signing
  - fixed user mismatch
  - inactive signer profile
  - QR SVG generation
  - print format cloning/insertion
- Add clearer messages when a standard print format is cloned and the copied print format must be selected.
- Review guest access for QR endpoint.
- Add migration/patch if future fields are introduced.
- Document expected manual Jinja snippet inside README.
- Consider child-table multi-signer support if multiple authorized signatories are required.

## 11. Manual Testing Checklist

### Installation

- Run:
  `bench --site app.duxdigitech.in list-apps`
- Confirm `dux_digital_signature` appears.

### DocTypes

- Confirm `Digital Signature User` exists.
- Confirm `Digital Signature Setup` exists.

### Signer Profile

- Create `Digital Signature User`.
- Select a Frappe `User`.
- Verify full name auto-fill.
- Verify designation auto-fill if Employee is linked.
- Verify `signature_text` default.
- Save.

### Document Setup

- Create `Digital Signature Setup`.
- Select target DocType.
- Select `Fixed User`.
- Select fixed user.
- Click `Create Signature Fields`.
- Confirm all `custom_signature_*` fields exist on target DocType.

### Submit Signing

- Use a safe test document only.
- Submit using the configured fixed user.
- Confirm:
  - `custom_is_digitally_signed = 1`
  - `custom_signed_by`
  - `custom_signed_by_user`
  - `custom_signed_on`
  - `custom_signature_hash`
  - `custom_signature_qr_data`

### Print Helper

- Add this snippet to a safe custom print format:

```jinja
{% if doc.custom_is_digitally_signed %}
{{ frappe.get_attr("dux_digital_signature.api.get_signature_html")(doc.doctype, doc.name) }}
{% endif %}
```

- Print signed test document.
- Confirm signature block appears with QR and SHA hash.

### Print Format Button

- Select a print format in `Digital Signature Setup`.
- Click `Add Signature To Print Format`.
- If selected format is standard, confirm copied format `{Name} Digital Signature` is created.
- Select the copied format in print view.
- Confirm QR signature block appears.

## 12. Safe Read-Only Commands Used

Commands used for reading/checking only:

```bash
cd ~/frappe-bench/apps/dux_digital_signature
pwd
find . -maxdepth 3 -type f | sort
find dux_digital_signature -type f | sort
git branch --show-current
git status --short
git log -1 --oneline
sed -n '1,240p' dux_digital_signature/hooks.py
sed -n '1,320p' dux_digital_signature/api.py
sed -n '1,260p' dux_digital_signature/dux_digital_signature/doctype/digital_signature_setup/digital_signature_setup.py
sed -n '260,560p' dux_digital_signature/dux_digital_signature/doctype/digital_signature_setup/digital_signature_setup.py
sed -n '1,220p' dux_digital_signature/dux_digital_signature/doctype/digital_signature_setup/digital_signature_setup.js
python -m json.tool dux_digital_signature/dux_digital_signature/doctype/digital_signature_setup/digital_signature_setup.json
python -m json.tool dux_digital_signature/dux_digital_signature/doctype/digital_signature_user/digital_signature_user.json
sed -n '1,220p' dux_digital_signature/dux_digital_signature/doctype/digital_signature_user/digital_signature_user.py
sed -n '1,220p' dux_digital_signature/dux_digital_signature/doctype/digital_signature_user/digital_signature_user.js
cat dux_digital_signature/dux_digital_signature/page/dux_digital_signature/dux_digital_signature.json
sed -n '1,980p' dux_digital_signature/dux_digital_signature/page/dux_digital_signature/dux_digital_signature.js
cat dux_digital_signature/modules.txt
cat dux_digital_signature/patches.txt
sed -n '1,180p' pyproject.toml
sed -n '1,220p' README.md
cd ~/frappe-bench
./env/bin/bench --site app.duxdigitech.in list-apps
```

One grep command failed due local PowerShell quoting; it did not modify anything.
