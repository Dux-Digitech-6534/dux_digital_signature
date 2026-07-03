(function () {
	const ROUTE = "dux-digital-signature";
	const BODY_CLASS = "dux-digital-signature-fullwidth";
	const STYLE_ID = "dux-digital-signature-html-style";
	const FIELD_ROWS = [
		["custom_is_digitally_signed", "Check"],
		["custom_signed_by", "Data"],
		["custom_signed_by_user", "Link User"],
		["custom_signed_on", "Datetime"],
		["custom_signature_designation", "Data"],
		["custom_signature_text", "Small Text"],
		["custom_signature_image", "Attach Image"],
		["custom_signature_hash", "Small Text"],
		["custom_signature_qr_data", "Long Text"],
	];

	function cleanupDigitalSignatureShell() {
		document.body.classList.remove(BODY_CLASS);
		const style = document.getElementById(STYLE_ID);
		if (style) style.remove();
	}

	function isDigitalSignatureRoute() {
		const route = frappe.get_route ? frappe.get_route() : [];
		return route && route[0] === ROUTE;
	}

	function registerRouteCleanup() {
		if (window.duxDigitalSignatureRouteCleanupRegistered) return;
		window.duxDigitalSignatureRouteCleanupRegistered = true;

		$(document).on("page-change", () => {
			setTimeout(() => {
				if (!isDigitalSignatureRoute()) cleanupDigitalSignatureShell();
			}, 0);
		});
	}

	registerRouteCleanup();

	frappe.pages[ROUTE] = frappe.pages[ROUTE] || {};
	frappe.pages[ROUTE].on_page_load = function (wrapper) {
		cleanupDigitalSignatureShell();
		const page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "",
			single_column: true,
		});

		$(wrapper).find(".page-head").hide();
		$(wrapper).addClass("dux-digital-signature-page");
		document.body.classList.add(BODY_CLASS);
		page.main.empty();
		ensureStyle();

		const root = document.createElement("div");
		root.id = "dux-digital-signature-root";
		root.innerHTML = getPageHtml();
		page.main.get(0).appendChild(root);

		const ui = new DigitalSignatureUI(root);
		ui.init();
	};
	frappe.pages[ROUTE].on_page_show = function () {
		document.body.classList.add(BODY_CLASS);
		ensureStyle();
	};
	frappe.pages[ROUTE].on_page_hide = cleanupDigitalSignatureShell;

	class DigitalSignatureUI {
		constructor(root) {
			this.root = root;
			this.activeSigner = null;
			this.activeSetup = null;
			this.setupRows = [];
			this.setupUserNames = {};
			this.userControl = null;
			this.documentTypeControl = null;
			this.fixedUserControl = null;
			this.printFormatControl = null;
		}

		init() {
			this.bindSearchDropdowns();
			this.bindTabs();
			this.bindActions();
			this.bindConditionalFields();
			this.renderFieldChecklist();
			this.loadSetups();
			this.setDocumentType("");
			const signerMode = this.root.querySelector("[data-signer-mode]");
			if (signerMode) signerMode.value = "Fixed User";
			this.updatePrintPreview();
		}

		bindSearchDropdowns() {
			this.makeSearchDropdown("[data-signer-user-fallback]", {
				doctype: "User",
				onSelect: (value) => {
					this.setSignerUser(value);
					this.prefillSigner();
				},
			});
			this.makeSearchDropdown("[data-document-type-fallback]", {
				doctype: "DocType",
				filters: { issingle: 0, istable: 0 },
				onSelect: (value) => {
					this.setDocumentType(value);
					this.setPrintFormat("");
					this.updatePrintPreview();
				},
			});
			this.makeSearchDropdown("[data-fixed-user-fallback]", {
				doctype: "User",
				onSelect: () => this.updatePrintPreview(),
			});
			this.makeSearchDropdown("[data-print-format-fallback]", {
				doctype: "Print Format",
				getFilters: () => {
					const documentType = this.getDocumentType();
					return documentType ? { doc_type: documentType } : {};
				},
			});
		}

		makeSearchDropdown(selector, options) {
			const input = this.root.querySelector(selector);
			if (!input) return;

			const wrapper = document.createElement("div");
			wrapper.className = "ds-search-field";
			input.parentNode.insertBefore(wrapper, input);
			wrapper.appendChild(input);

			const dropdown = document.createElement("div");
			dropdown.className = "ds-search-results";
			wrapper.appendChild(dropdown);

			let timer = null;
			const close = () => dropdown.classList.remove("open");
			const normalizeRows = (message) => {
				const raw = Array.isArray(message) ? message : ((message && message.results) || []);
				return raw.map((row) => {
					if (typeof row === "string") return { value: row, description: "" };
					return {
						value: row.value || row.name || row.label || row[0] || "",
						description: row.description || row.label || row[1] || "",
					};
				}).filter((row) => row.value);
			};
			const renderRows = (rows) => {
				if (!rows.length) {
					dropdown.innerHTML = `<div class="ds-search-empty">No records found</div>`;
					dropdown.classList.add("open");
					return;
				}
				dropdown.innerHTML = rows.map((row) => `
					<button type="button" class="ds-search-option" data-value="${escapeAttr(row.value)}">
						<span>${escapeHtml(row.value)}</span>
						${row.description ? `<small>${escapeHtml(row.description)}</small>` : ""}
					</button>
				`).join("");
				dropdown.querySelectorAll(".ds-search-option").forEach((option) => {
					option.addEventListener("mousedown", (event) => {
						event.preventDefault();
						input.value = option.dataset.value || "";
						if (options.onSelect) options.onSelect(input.value);
						close();
					});
				});
				dropdown.classList.add("open");
			};
			const search = (txt) => {
				frappe.call({
					method: "frappe.desk.search.search_link",
					args: {
						doctype: options.doctype,
						txt: txt || "",
						filters: options.getFilters ? options.getFilters() : (options.filters || {}),
						page_length: 20,
					},
					callback: (response) => renderRows(normalizeRows(response.message)),
				});
			};
			const scheduleSearch = () => {
				clearTimeout(timer);
				timer = setTimeout(() => search(input.value), 120);
			};

			input.setAttribute("autocomplete", "off");
			input.addEventListener("focus", () => search(""));
			input.addEventListener("click", () => search(input.value));
			input.addEventListener("input", scheduleSearch);
			input.addEventListener("keydown", (event) => {
				if (event.key === "Escape") close();
			});
			document.addEventListener("mousedown", (event) => {
				if (!wrapper.contains(event.target)) close();
			});
		}

		makeUserLinkControl() {
			this.userControl = this.makeLinkControl("[data-signer-user-control]", {
				options: "User",
				fieldname: "user",
				placeholder: "Select User",
				onchange: () => this.prefillSigner(),
			});
			const fallback = this.root.querySelector("[data-signer-user-fallback]");
			if (fallback) fallback.style.display = "none";
		}

		makeSetupLinkControls() {
			this.documentTypeControl = this.makeLinkControl("[data-document-type-control]", {
				options: "DocType",
				fieldname: "document_type",
				placeholder: "Select Document Type",
				onchange: () => {
					this.setPrintFormat("");
					this.updatePrintPreview();
				},
			});
			this.fixedUserControl = this.makeLinkControl("[data-fixed-user-control]", {
				options: "User",
				fieldname: "fixed_user",
				placeholder: "Select Fixed User",
				onchange: () => this.updatePrintPreview(),
			});
			this.printFormatControl = this.makeLinkControl("[data-print-format-control]", {
				options: "Print Format",
				fieldname: "print_format",
				placeholder: "Select Print Format",
				get_query: () => {
					const documentType = this.getDocumentType();
					return documentType ? { filters: { doc_type: documentType } } : {};
				},
			});
		}

		makeLinkControl(selector, df) {
			const parent = this.root.querySelector(selector);
			if (!parent || !frappe.ui || !frappe.ui.form || !frappe.ui.form.make_control) return null;

			const control = frappe.ui.form.make_control({
				parent,
				df: {
					fieldtype: "Link",
					...df,
				},
				render_input: true,
			});
			parent.classList.add("ds-link-control-ready");
			this.makeLinkDropdownOpenOnClick(control);
			const fallback = parent.parentElement && parent.parentElement.querySelector("input[type='text']");
			if (fallback) fallback.style.display = "none";
			return control;
		}

		makeLinkDropdownOpenOnClick(control) {
			setTimeout(() => {
				if (!control || !control.$input) return;

				if (control.awesomplete) {
					control.awesomplete.minChars = 0;
				}

				control.$input.on("focus click", () => {
					control.$input.trigger("input");
					if (control.awesomplete && control.awesomplete.evaluate) {
						control.awesomplete.evaluate();
					}
				});
			}, 0);
		}

		bindTabs() {
			this.root.querySelectorAll("[data-view]").forEach((tab) => {
				tab.addEventListener("click", () => this.showView(tab.dataset.view));
			});
		}

		showView(name) {
			this.root.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
			const view = this.root.querySelector(`#view-${name}`);
			if (view) view.classList.add("active");
			this.root.querySelectorAll(".tab").forEach((tab) => {
				tab.classList.toggle("active", tab.dataset.view === name);
			});
		}

		bindActions() {
			const bind = (selector, event, handler) => {
				this.root.querySelectorAll(selector).forEach((element) => {
					element.addEventListener(event, handler);
				});
			};
			bind("[data-new-signer]", "click", () => this.openSignerForm());
			bind("[data-cancel-signer]", "click", () => this.closeSignerForm());
			bind("[data-save-signer]", "click", () => this.saveSigner());
			bind("[data-new-setup]", "click", () => this.openNewSetup());
			bind("[data-cancel-setup]", "click", () => this.showSetupList());
			bind("[data-save-setup]", "click", () => this.saveSetup());
			bind("[data-create-fields]", "click", () => this.createFields());
			bind("[data-add-print]", "click", () => this.addToPrintFormat());
			bind("[data-setup-search]", "input", () => this.applySetupFilters());
			bind("[data-setup-doc-filter]", "change", () => this.applySetupFilters());
			bind("[data-setup-user-filter]", "change", () => this.applySetupFilters());
			bind("[data-document-type-fallback]", "change", () => this.updatePrintPreview());
			bind("[data-fixed-user-fallback]", "change", () => this.updatePrintPreview());
		}

		bindConditionalFields() {
			const trigger = this.root.querySelector("[data-trigger]");
			const signerMode = this.root.querySelector("[data-signer-mode]");
			const sync = () => {
				this.root.querySelector("[data-final-approval-field]").style.display =
					trigger.value === "On Final Approval" ? "block" : "none";
				const fixedUserField = this.root.querySelector("[data-fixed-user-field]");
				if (fixedUserField) fixedUserField.style.display = "block";
				if (signerMode) signerMode.value = "Fixed User";
			};
			trigger.addEventListener("change", sync);
			if (signerMode) signerMode.addEventListener("change", sync);
			sync();
		}

		loadSigners() {
			frappe.db.get_list("Digital Signature User", {
				fields: ["name", "user", "full_name", "designation", "is_active"],
				limit: 20,
				order_by: "modified desc",
			}).then((rows) => this.renderSigners(rows || []));
		}

		renderSigners(rows) {
			const list = this.root.querySelector("[data-signer-list]");
			if (!list) return;
			if (!rows.length) {
				list.innerHTML = `
					<div class="empty-state">No signer profiles yet. Create the first signer to start using digital signatures.</div>
				`;
				return;
			}

			list.innerHTML = rows.map((row) => `
				<div class="list-row" data-signer-name="${escapeAttr(row.name)}">
					${sealSvg(row.full_name || row.user || row.name, !!row.is_active)}
					<div>
						<div class="lname">${escapeHtml(row.full_name || row.user || row.name)}</div>
						<div class="ldesig">${escapeHtml(row.designation || "No designation")}</div>
					</div>
					<div class="lright">${badge(row.is_active ? "Active" : "Inactive", row.is_active ? "verified" : "slate")}</div>
				</div>
			`).join("");

			list.querySelectorAll("[data-signer-name]").forEach((row) => {
				row.addEventListener("click", () => this.editSigner(row.dataset.signerName));
			});
		}

		loadSetups() {
			frappe.db.get_list("Digital Signature Setup", {
				fields: ["name", "document_type", "enabled", "signature_trigger", "signer", "fixed_user", "print_format", "is_setup_completed"],
				limit: 100,
				order_by: "modified desc",
			}).then((rows) => {
				this.setupRows = rows || [];
				this.loadSetupUserNames(this.setupRows).then(() => {
					this.populateSetupFilters();
					this.applySetupFilters();
				});
			});
		}

		loadSetupUserNames(rows) {
			const users = [...new Set(rows.map((row) => row.fixed_user).filter(Boolean))];
			if (!users.length) return Promise.resolve();

			return Promise.all(users.map((user) => {
				if (this.setupUserNames[user]) return Promise.resolve();
				return frappe.db.get_value("User", user, "full_name").then((response) => {
					this.setupUserNames[user] = (response.message && response.message.full_name) || user;
				});
			}));
		}

		populateSetupFilters() {
			const docFilter = this.root.querySelector("[data-setup-doc-filter]");
			const userFilter = this.root.querySelector("[data-setup-user-filter]");
			if (!docFilter || !userFilter) return;

			const currentDoc = docFilter.value;
			const currentUser = userFilter.value;
			const doctypes = [...new Set(this.setupRows.map((row) => row.document_type).filter(Boolean))].sort();
			const users = [...new Set(this.setupRows.map((row) => row.fixed_user).filter(Boolean))].sort((a, b) => {
				return (this.setupUserNames[a] || a).localeCompare(this.setupUserNames[b] || b);
			});

			docFilter.innerHTML = `<option value="">All Documents</option>${doctypes.map((doctype) => (
				`<option value="${escapeAttr(doctype)}">${escapeHtml(doctype)}</option>`
			)).join("")}`;
			userFilter.innerHTML = `<option value="">All Users</option>${users.map((user) => (
				`<option value="${escapeAttr(user)}">${escapeHtml(this.setupUserNames[user] || user)}</option>`
			)).join("")}`;

			docFilter.value = doctypes.includes(currentDoc) ? currentDoc : "";
			userFilter.value = users.includes(currentUser) ? currentUser : "";
		}

		applySetupFilters() {
			const search = (this.root.querySelector("[data-setup-search]")?.value || "").trim().toLowerCase();
			const docFilter = this.root.querySelector("[data-setup-doc-filter]")?.value || "";
			const userFilter = this.root.querySelector("[data-setup-user-filter]")?.value || "";
			const rows = this.setupRows.filter((row) => {
				const userName = this.setupUserNames[row.fixed_user] || row.fixed_user || "";
				const searchable = [
					row.name,
					row.document_type,
					row.signature_trigger,
					row.print_format,
					row.fixed_user,
					userName,
				].filter(Boolean).join(" ").toLowerCase();

				return (!search || searchable.includes(search))
					&& (!docFilter || row.document_type === docFilter)
					&& (!userFilter || row.fixed_user === userFilter);
			});
			this.renderSetupSummary(rows);
		}

		renderSetupSummary(rows) {
			const target = this.root.querySelector("[data-setup-list]");
			if (!target) return;
			if (!rows.length) {
				target.innerHTML = `<div class="empty-state">No document signature setup found for selected filters.</div>`;
				return;
			}

			target.innerHTML = rows.map((row) => `
				<div class="setup-row" data-setup-name="${escapeAttr(row.name)}">
					<div>
						<div class="setup-title">${escapeHtml(row.document_type || row.name)}</div>
						<div class="setup-meta">${escapeHtml(row.signature_trigger || "")}${row.print_format ? ` - ${escapeHtml(row.print_format)}` : ""}</div>
						<div class="setup-user">User: ${escapeHtml(this.setupUserNames[row.fixed_user] || row.fixed_user || "Not selected")}</div>
					</div>
					<div class="setup-status">${badge(row.enabled ? "Enabled" : "Disabled", row.enabled ? "verified" : "slate")}</div>
				</div>
			`).join("");

			target.querySelectorAll("[data-setup-name]").forEach((row) => {
				row.addEventListener("click", () => this.editSetup(row.dataset.setupName));
			});
		}

		loadDocTypes() {
			frappe.db.get_list("DocType", {
				fields: ["name"],
				filters: { issingle: 0, istable: 0 },
				limit: 100,
				order_by: "name asc",
			}).then((rows) => {
				const select = this.root.querySelector("[data-document-type]");
				const preferred = ["Purchase Order", "Sales Order", "Purchase Invoice", "Expense Claim"];
				const names = [...new Set([...preferred, ...(rows || []).map((row) => row.name)])];
				select.innerHTML = names.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
				select.value = "";
				this.loadPrintFormats();
			});
		}

		loadPrintFormats() {
			const documentType = this.root.querySelector("[data-document-type]").value;
			const select = this.root.querySelector("[data-print-format]");
			if (!documentType) {
				select.innerHTML = `<option value="">Select document type first</option>`;
				return;
			}

			frappe.db.get_list("Print Format", {
				fields: ["name", "standard"],
				filters: { doc_type: documentType },
				limit: 100,
				order_by: "name asc",
			}).then((rows) => {
				if (!rows.length) {
					select.innerHTML = `<option value="">No print format found</option>`;
					return;
				}
				select.innerHTML = rows.map((row) => {
					const label = `${row.name}${row.standard === "Yes" ? " (Standard)" : ""}`;
					return `<option value="${escapeAttr(row.name)}">${escapeHtml(label)}</option>`;
				}).join("");
			});
		}

		renderFieldChecklist() {
			const target = this.root.querySelector("[data-field-checklist]");
			target.innerHTML = "";
		}

		showSetupList() {
			const list = this.root.querySelector("[data-setup-list-view]");
			const form = this.root.querySelector("[data-setup-form-view]");
			if (list) list.style.display = "block";
			if (form) form.style.display = "none";
			this.activeSetup = null;
		}

		showSetupForm() {
			const list = this.root.querySelector("[data-setup-list-view]");
			const form = this.root.querySelector("[data-setup-form-view]");
			if (list) list.style.display = "none";
			if (form) form.style.display = "block";
		}

		openNewSetup() {
			this.activeSetup = null;
			this.root.querySelector("[data-current-setup]").value = "";
			this.root.querySelector("[data-setup-form-title]").textContent = "New Document Signature";
			this.root.querySelector("[data-enabled]").checked = true;
			this.setDocumentType("");
			this.root.querySelector("[data-trigger]").value = "On Submit";
			this.root.querySelector("[data-final-approval]").value = "";
			this.setFixedUser("");
			this.setPrintFormat("");
			this.setPrintFormatUpdateMode("Update Selected Print Format");
			this.setSignaturePlacement("Existing Print Format Signature Section");
			this.bindConditionalFields();
			this.updatePrintPreview();
			this.showSetupForm();
		}

		editSetup(name) {
			frappe.db.get_doc("Digital Signature Setup", name).then((doc) => {
				this.activeSetup = doc.name;
				this.root.querySelector("[data-current-setup]").value = doc.name || "";
				this.root.querySelector("[data-setup-form-title]").textContent = `Edit Document Signature - ${doc.document_type || doc.name}`;
				this.root.querySelector("[data-enabled]").checked = !!doc.enabled;
				this.setDocumentType(doc.document_type || "");
				this.root.querySelector("[data-trigger]").value = doc.signature_trigger || "On Submit";
				this.root.querySelector("[data-final-approval]").value = doc.final_approval_state || "";
				this.setFixedUser(doc.fixed_user || "");
				this.setPrintFormat(doc.print_format || "");
				this.setPrintFormatUpdateMode(doc.print_format_update_mode || "Update Selected Print Format");
				this.setSignaturePlacement(doc.signature_placement || "Existing Print Format Signature Section");
				this.bindConditionalFields();
				this.updatePrintPreview();
				this.showSetupForm();
			});
		}

		openSignerForm(data) {
			const form = this.root.querySelector("[data-signer-form]");
			form.style.display = "flex";
			this.root.querySelector("[data-signer-form-title]").textContent = data ? `Edit Signer - ${data.full_name || data.name}` : "New Signer";
			this.setSignerUser(data ? data.user || data.name : "");
			this.root.querySelector("[data-signer-full-name]").value = data ? data.full_name || "" : "";
			this.root.querySelector("[data-signer-designation]").value = data ? data.designation || "" : "";
			this.root.querySelector("[data-signer-active]").checked = data ? !!data.is_active : true;
			this.activeSigner = data ? data.name : null;
			this.updateSignerPreview();
		}

		closeSignerForm() {
			this.root.querySelector("[data-signer-form]").style.display = "none";
			this.activeSigner = null;
		}

		editSigner(name) {
			frappe.db.get_doc("Digital Signature User", name).then((doc) => this.openSignerForm(doc));
		}

		prefillSigner() {
			const user = this.getSignerUser();
			if (!user) return;
			frappe.call({
				method: "dux_digital_signature.api.get_user_details",
				args: { user },
				callback: (response) => {
					const details = response.message || {};
					const fullName = this.root.querySelector("[data-signer-full-name]");
					const designation = this.root.querySelector("[data-signer-designation]");
					if (!fullName.value) fullName.value = details.full_name || user;
					if (!designation.value) designation.value = details.designation || "";
					this.root.querySelector("[data-prefill-msg]").style.display = "flex";
					this.updateSignerPreview();
				},
			});
		}

		updateSignerPreview() {
			const name = this.root.querySelector("[data-signer-full-name]").value || "-";
			const designation = this.root.querySelector("[data-signer-designation]").value || "Digitally signed by -";
			const card = this.root.querySelector("[data-signer-preview]");
			card.classList.toggle("pending", name === "-");
			card.querySelector(".top").textContent = name === "-" ? "PENDING" : "READY";
			card.querySelector(".name").textContent = name;
			card.querySelector(".desig").textContent = designation;
		}

		saveSigner() {
			const values = {
				doctype: "Digital Signature User",
				name: this.activeSigner || this.getSignerUser(),
				user: this.getSignerUser(),
				full_name: this.root.querySelector("[data-signer-full-name]").value,
				designation: this.root.querySelector("[data-signer-designation]").value,
				is_active: this.root.querySelector("[data-signer-active]").checked ? 1 : 0,
			};

			if (!values.user || !values.full_name) {
				frappe.msgprint("Please select User and enter Full Name.");
				return;
			}

			const method = this.activeSigner ? "frappe.client.save" : "frappe.client.insert";
			frappe.call({
				method,
				args: { doc: values },
				callback: () => {
					frappe.show_alert({ message: "Signer saved", indicator: "green" });
					this.closeSignerForm();
					this.loadSigners();
				},
			});
		}

		getSignerUser() {
			if (this.userControl) return this.userControl.get_value();
			const input = this.root.querySelector("[data-signer-user-fallback]");
			return input ? input.value : "";
		}

		setSignerUser(value) {
			if (this.userControl) {
				this.userControl.set_value(value || "");
				return;
			}
			const input = this.root.querySelector("[data-signer-user-fallback]");
			if (input) input.value = value || "";
		}

		getDocumentType() {
			if (this.documentTypeControl) return this.documentTypeControl.get_value();
			const input = this.root.querySelector("[data-document-type-fallback]");
			return input ? input.value : "";
		}

		setDocumentType(value) {
			if (this.documentTypeControl) {
				this.documentTypeControl.set_value(value || "");
				return;
			}
			const input = this.root.querySelector("[data-document-type-fallback]");
			if (input) input.value = value || "";
		}

		getFixedUser() {
			if (this.fixedUserControl) return this.fixedUserControl.get_value();
			const input = this.root.querySelector("[data-fixed-user-fallback]");
			return input ? input.value : "";
		}

		setFixedUser(value) {
			if (this.fixedUserControl) {
				this.fixedUserControl.set_value(value || "");
				return;
			}
			const input = this.root.querySelector("[data-fixed-user-fallback]");
			if (input) input.value = value || "";
		}

		getPrintFormat() {
			if (this.printFormatControl) return this.printFormatControl.get_value();
			const input = this.root.querySelector("[data-print-format-fallback]");
			return input ? input.value : "";
		}

		setPrintFormat(value) {
			if (this.printFormatControl) {
				this.printFormatControl.set_value(value || "");
				return;
			}
			const input = this.root.querySelector("[data-print-format-fallback]");
			if (input) input.value = value || "";
		}

		getPrintFormatUpdateMode() {
			const input = this.root.querySelector("[data-print-format-update-mode]");
			return input ? input.value : "Update Selected Print Format";
		}

		setPrintFormatUpdateMode(value) {
			const input = this.root.querySelector("[data-print-format-update-mode]");
			if (input) input.value = value || "Update Selected Print Format";
		}

		getSignaturePlacement() {
			const input = this.root.querySelector("[data-signature-placement]");
			return input ? input.value : "Existing Print Format Signature Section";
		}

		setSignaturePlacement(value) {
			const input = this.root.querySelector("[data-signature-placement]");
			if (input) input.value = value || "Existing Print Format Signature Section";
		}

		updatePrintPreview() {
			const documentType = this.getDocumentType() || "Document";
			const fixedUser = this.getFixedUser();
			const nameTarget = this.root.querySelector("[data-preview-signer]");
			const detailTarget = this.root.querySelector("[data-preview-detail]");
			const documentTarget = this.root.querySelector("[data-preview-document]");

			documentTarget.textContent = `Document Type: ${documentType}`;
			if (!fixedUser) {
				nameTarget.textContent = "Authorised Signatory";
				detailTarget.textContent = "Designation";
				return;
			}

			frappe.db.get_value("User", fixedUser, "full_name").then((response) => {
				nameTarget.textContent = (response.message && response.message.full_name) || fixedUser;
			});
			frappe.db.get_value("Employee", { user_id: fixedUser, status: "Active" }, "designation").then((response) => {
				detailTarget.textContent = (response.message && response.message.designation) || "Designation";
			});
		}

		saveSetup() {
			this.persistSetup().then(() => {
				frappe.show_alert({ message: "Setup saved", indicator: "green" });
				this.loadSetups();
				this.showSetupList();
			});
		}

		buildSetupDoc() {
			return {
				doctype: "Digital Signature Setup",
				name: this.activeSetup || this.root.querySelector("[data-current-setup]").value || undefined,
				enabled: this.root.querySelector("[data-enabled]").checked ? 1 : 0,
				document_type: this.getDocumentType(),
				signature_trigger: this.root.querySelector("[data-trigger]").value,
				final_approval_state: this.root.querySelector("[data-final-approval]").value,
				signer: "Fixed User",
				fixed_user: this.getFixedUser(),
				print_format: this.getPrintFormat(),
				print_format_update_mode: this.getPrintFormatUpdateMode(),
				signature_placement: this.getSignaturePlacement(),
			};
		}

		persistSetup() {
			const doc = this.buildSetupDoc();
			const fixedUser = doc.fixed_user;

			return this.ensureFixedUserSigner(fixedUser)
				.then(() => (doc.name ? frappe.db.get_doc("Digital Signature Setup", doc.name) : doc))
				.then((latestDoc) => {
					const setupDoc = Object.assign(latestDoc, doc);
					const method = setupDoc.name ? "frappe.client.save" : "frappe.client.insert";

					return new Promise((resolve) => {
						frappe.call({
							method,
							args: { doc: setupDoc },
							callback: (response) => {
								if (response.message && response.message.name) {
									this.activeSetup = response.message.name;
									this.root.querySelector("[data-current-setup]").value = response.message.name;
								}
								resolve(response.message);
							},
						});
					});
				});
		}

		createFields() {
			this.callSetupMethod("create_signature_fields", "Signature fields updated.");
		}

		addToPrintFormat() {
			this.callSetupMethod("add_signature_to_print_format", "Print format updated.");
		}

		callSetupMethod(method, fallbackMessage) {
			this.persistSetup().then(() => {
				const setup = this.root.querySelector("[data-current-setup]").value;
				return frappe.db.get_doc("Digital Signature Setup", setup);
			}).then((doc) => {
				doc.enabled = this.root.querySelector("[data-enabled]").checked ? 1 : 0;
				doc.document_type = this.getDocumentType();
				doc.signature_trigger = this.root.querySelector("[data-trigger]").value;
				doc.final_approval_state = this.root.querySelector("[data-final-approval]").value;
				doc.signer = "Fixed User";
				doc.fixed_user = this.getFixedUser();
				doc.print_format = this.getPrintFormat();
				doc.print_format_update_mode = this.getPrintFormatUpdateMode();
				doc.signature_placement = this.getSignaturePlacement();

				frappe.call({
					method: "run_doc_method",
					args: {
						docs: JSON.stringify(doc),
						method,
					},
					callback: (response) => frappe.msgprint(response.message || fallbackMessage),
				});
			});
		}

		ensureFixedUserSigner(user) {
			if (!user) return Promise.resolve();

			return frappe.db.get_value("Digital Signature User", { user }, "name").then((existing) => {
				if (existing.message && existing.message.name) return null;

				return new Promise((resolve) => {
					frappe.call({
						method: "dux_digital_signature.api.get_user_details",
						args: { user },
						callback: (response) => {
							const details = response.message || {};
							frappe.call({
								method: "frappe.client.insert",
								args: {
									doc: {
										doctype: "Digital Signature User",
										name: user,
										user,
										full_name: details.full_name || user,
										designation: details.designation || "",
										signature_text: details.signature_text || `Digitally signed by ${details.full_name || user}`,
										is_active: 1,
									},
								},
								callback: () => resolve(),
								error: () => resolve(),
							});
						},
						error: () => resolve(),
					});
				});
			});
		}
	}

	function getPageHtml() {
		return `
			<div class="ds-html-ui">
				<div class="ds-shell">
				<div class="content">
					<section class="view active" id="view-doctype">
						<div class="page-title">
							<div class="title-rule"></div>
							<div>
								<div class="eyebrow">Setup - Signature workflow</div>
								<h1>Document Signatures</h1>
								<p>Pick a document type, choose the fixed signer and when signing should happen, then place the signature on your fields and print format.</p>
							</div>
						</div>

						<div data-setup-list-view>
							<div class="card">
								<div class="card-head row-between">
									<h3>Document Signature List</h3>
									<button class="btn btn-primary btn-sm" data-new-setup>+ Add New</button>
								</div>
								<div class="list-filters">
									<div class="field">
										<label>Search</label>
										<input type="text" data-setup-search placeholder="Search document, user, print format">
									</div>
									<div class="field">
										<label>Document</label>
										<select data-setup-doc-filter>
											<option value="">All Documents</option>
										</select>
									</div>
									<div class="field">
										<label>User</label>
										<select data-setup-user-filter>
											<option value="">All Users</option>
										</select>
									</div>
								</div>
								<div data-setup-list>
									<div class="empty-state">Loading document signatures...</div>
								</div>
							</div>
						</div>

						<div data-setup-form-view style="display:none;">
							<div class="setup-layout">
								<div class="form-col">
									<section class="section">
										<div class="section-head">
											<span class="roman">I.</span>
											<h2 data-setup-form-title>Document &amp; trigger</h2>
											<button class="link-backup section-back" data-cancel-setup type="button">Back To List</button>
										</div>
										<input type="hidden" data-current-setup>
										<input type="hidden" data-signer-mode value="Fixed User">
										<div class="field-grid">
											<div class="field field-required span-2">
												<label>Document Type</label>
												<div data-document-type-control></div>
												<input type="text" data-document-type-fallback placeholder="Select Document Type">
											</div>

											<div class="field field-required span-2">
												<label>Signature Trigger</label>
												<select data-trigger>
													<option>On Submit</option>
													<option>On Final Approval</option>
												</select>
												<div class="hint">On Submit signs the document the moment it is submitted.</div>
											</div>

											<div class="conditional-field span-2" data-final-approval-field style="display:none;">
												<div class="conditional-inner">
													<label>Final Approval State</label>
													<input type="text" data-final-approval placeholder="e.g. Approved">
												</div>
											</div>

											<div class="field field-required span-2" data-fixed-user-field>
												<label>Fixed User</label>
												<div data-fixed-user-control></div>
												<input type="text" data-fixed-user-fallback placeholder="user@example.com">
												<div class="hint">A signer profile is created automatically the first time this setup is saved.</div>
											</div>

											<div class="field span-2">
												<label>Is Active</label>
												<label class="active-toggle">
													<input type="checkbox" data-enabled checked>
													<span>
														<strong>Enable this signature setup</strong>
														<small>Turn this off temporarily instead of deleting the setup.</small>
													</span>
												</label>
											</div>
										</div>
									</section>

									<section class="section">
										<div class="section-head">
											<span class="roman">II.</span>
											<h2>Target fields</h2>
										</div>
										<div class="checklist" data-field-checklist></div>
										<button class="map-btn" data-create-fields>
											Create / Update Fields
										</button>
									</section>
								</div>

								<aside class="preview-col">
									<div class="preview-card">
										<h2>III. Print format &amp; seal</h2>
										<p class="sub">This is how the signature will appear on the printed document.</p>
										<div class="field" style="margin-bottom:18px;">
											<label>Print Format</label>
											<div data-print-format-control></div>
											<input type="text" data-print-format-fallback placeholder="Select Print Format">
										</div>
										<div class="field" style="margin-bottom:18px;">
											<label>Signature Placement</label>
											<select data-signature-placement>
												<option value="Existing Print Format Signature Section">Existing Print Format Signature Section</option>
												<option value="Default Signature Block">QR Digital Signature Block</option>
											</select>
										</div>
										<div class="pf-actions">
											<button class="btn-add-block" data-add-print>Add Signature Block</button>
										</div>

										<div class="preview-divider"><span>PREVIEW</span></div>
										<div class="sig-card preview-original">
											<div class="qr po-icon">${qrSvg()}</div>
											<div class="po-text">
												<div class="top signed-tag">DIGITALLY SIGNED</div>
												<div class="name signer-name" data-preview-signer>Authorised Signatory</div>
												<div class="desig signer-role" data-preview-detail>Designation</div>
												<div class="meta doc-line" data-preview-document>Document Type: Document</div>
												<div class="hash mono">SHA-256 8f3a1c...e2d90b41</div>
											</div>
										</div>
									</div>
								</aside>
							</div>

							<div class="footer-bar">
								<p class="note">Actions save this setup automatically when needed.</p>
								<div class="footer-actions">
									<button class="btn-cancel" data-cancel-setup type="button">Cancel</button>
									<button class="btn-save" data-save-setup>Save Setup</button>
								</div>
							</div>
						</div>
					</section>
				</div>
				</div>
			</div>
		`;
	}

	function badge(label, type) {
		return `<span class="badge badge-${type}"><span class="badge-dot"></span>${escapeHtml(label)}</span>`;
	}

	function brandSvg() {
		return `
			<svg viewBox="0 0 40 40" fill="none">
				<circle cx="20" cy="20" r="18" stroke="#B08D57" stroke-width="1.4"></circle>
				<circle cx="20" cy="20" r="13.5" stroke="#B08D57" stroke-width="1" stroke-dasharray="1.6 3.2"></circle>
				<path d="M13 20.5l4.5 4.5L27.5 14.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
			</svg>
		`;
	}

	function sealSvg(name, active) {
		const initials = String(name || "DS").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "DS";
		const fill = active ? "#E7F3EC" : "#EEF0F1";
		const stroke = active ? "#1F7A4D" : "#9AA1A8";
		const text = active ? "#1F7A4D" : "#6B7280";
		return `
			<svg class="seal" viewBox="0 0 40 40">
				<circle cx="20" cy="20" r="17" fill="${fill}" stroke="${stroke}" stroke-width="1.2"></circle>
				<text x="20" y="25" text-anchor="middle" font-family="Fraunces" font-size="14" fill="${text}">${escapeHtml(initials)}</text>
			</svg>
		`;
	}

	function qrSvg() {
		return `
			<svg viewBox="0 0 56 56" width="56" height="56">
				<rect width="56" height="56" fill="#fff"></rect>
				<g fill="#1B2430">
					<rect x="4" y="4" width="14" height="14"></rect><rect x="7" y="7" width="8" height="8" fill="#fff"></rect><rect x="9.5" y="9.5" width="3" height="3"></rect>
					<rect x="38" y="4" width="14" height="14"></rect><rect x="41" y="7" width="8" height="8" fill="#fff"></rect><rect x="43.5" y="9.5" width="3" height="3"></rect>
					<rect x="4" y="38" width="14" height="14"></rect><rect x="7" y="41" width="8" height="8" fill="#fff"></rect><rect x="9.5" y="43.5" width="3" height="3"></rect>
					<rect x="24" y="24" width="3" height="3"></rect><rect x="30" y="24" width="3" height="3"></rect><rect x="24" y="30" width="3" height="3"></rect><rect x="36" y="30" width="3" height="3"></rect>
					<rect x="42" y="36" width="3" height="3"></rect><rect x="24" y="42" width="3" height="3"></rect><rect x="36" y="42" width="3" height="3"></rect>
				</g>
			</svg>
		`;
	}

	function ensureStyle() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = `
			@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");
			:root {
				--ink:#1B2A4A;
				--ink-2:#28395E;
				--paper:#F5F5F0;
				--card:#FFFFFF;
				--rule:#E3DFD4;
				--rule-strong:#D3CDBC;
				--verified:#1F7A5C;
				--verified-soft:#E7F3EE;
				--amber:#B08D57;
				--amber-soft:#EFE4CF;
				--rust:#A23E2E;
				--rust-soft:#F6E7E3;
				--slate:#6B7280;
				--slate-soft:#EEF0F1;
				--radius:10px;
				--shadow:0 1px 2px rgba(27,42,74,.06), 0 8px 24px -12px rgba(27,42,74,.18);
			}
			body.dux-digital-signature-fullwidth .page-content,
			body.dux-digital-signature-fullwidth .layout-main,
			body.dux-digital-signature-fullwidth .layout-main-section-wrapper,
			body.dux-digital-signature-fullwidth .layout-main-section {
				padding: 0 !important;
				margin: 0 !important;
				max-width: none !important;
				width: 100% !important;
			}
			#dux-digital-signature-root {
				min-height: calc(100vh - 1px);
				background:
					radial-gradient(1200px 500px at 15% -10%, #FBFAF6 0%, var(--paper) 55%),
					var(--paper);
				color: var(--ink);
				font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				font-size: 14px;
				-webkit-font-smoothing: antialiased;
			}
			#dux-digital-signature-root * { box-sizing: border-box; }
			.ds-shell {
				display: block;
				min-height: calc(100vh - 1px);
				width: 100%;
			}
			#dux-digital-signature-root h1,
			#dux-digital-signature-root h2,
			#dux-digital-signature-root h3 {
				font-family: Fraunces, serif;
				font-weight: 600;
				margin: 0;
			}
			#dux-digital-signature-root button { font-family: inherit; }
			.mono { font-family: "IBM Plex Mono", monospace; }
			.topbar {
				display: flex;
				align-items: center;
				gap: 28px;
				padding: 0 28px;
				height: 60px;
				background: var(--ink);
				color: #fff;
				position: sticky;
				top: 0;
				z-index: 10;
			}
			.brand { display:flex; align-items:center; gap:9px; }
			.brand svg { width:26px; height:26px; flex:none; }
			.brand span { font-family: Fraunces, serif; font-size:16px; font-weight:600; }
			.tabs { display:flex; gap:4px; margin-left:auto; margin-right:auto; }
			.tab {
				padding: 9px 18px;
				border-radius: 20px;
				font-size: 13px;
				font-weight: 600;
				color: #B9C0C6;
				cursor: pointer;
				border: 1px solid transparent;
			}
			.tab:hover { color:#fff; }
			.tab.active { background:#fff; color:var(--ink); }
			.topbar-spacer { width:26px; }
			.content { width:100%; max-width:1180px; margin:0 auto; padding:52px 32px 80px; }
			.setup-layout {
				display:grid;
				grid-template-columns:1.55fr 1fr;
				gap:28px;
				align-items:start;
			}
			.form-col { display:flex; flex-direction:column; gap:22px; }
			.page-grid { display:grid; grid-template-columns:minmax(0, 1fr) 320px; gap:18px; align-items:start; }
			.main-column { min-width:0; }
			.side-column { min-width:0; }
			.side-card { position:sticky; top:72px; }
			.view { display:none; }
			.view.active { display:block; animation: dsFade .2s ease; }
			@keyframes dsFade { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
			.page-title {
				margin-bottom:28px;
				display:grid;
				grid-template-columns:4px minmax(0, 1fr);
				gap:22px;
				align-items:start;
				max-width:760px;
			}
			.title-rule {
				width:4px;
				align-self:stretch;
				min-height:64px;
				background:linear-gradient(180deg, var(--ink) 0%, var(--amber) 100%);
				border-radius:3px;
			}
			.eyebrow {
				font-family:"IBM Plex Mono", monospace;
				font-size:11.5px;
				letter-spacing:.14em;
				text-transform:uppercase;
				color:var(--verified);
				font-weight:600;
				margin:2px 0 8px;
			}
			.page-title h1 { font-size:clamp(28px, 3.6vw, 40px); line-height:1.08; color:var(--ink); }
			.page-title p { margin:0; color:var(--slate); font-size:15px; line-height:1.55; max-width:560px; }
			.card {
				background:var(--card);
				border:1px solid var(--rule);
				border-radius:var(--radius);
				margin-bottom:18px;
				box-shadow:var(--shadow);
				overflow:hidden;
			}
			.card-head {
				padding:15px 20px;
				border-bottom:1px solid var(--rule);
				display:flex;
				justify-content:space-between;
				align-items:center;
				background:#FAFAF7;
			}
			.card-head h3 { font-size:14px; }
			.card-body { padding:26px 24px; }
			.section {
				background:var(--card);
				border:1px solid var(--rule);
				border-radius:var(--radius);
				box-shadow:var(--shadow);
				padding:26px 28px 28px;
			}
			.section-head {
				display:flex;
				align-items:baseline;
				gap:12px;
				margin-bottom:22px;
				padding-bottom:16px;
				border-bottom:1px solid var(--rule);
			}
			.section-head h2 {
				font-family:Fraunces, serif;
				font-weight:600;
				font-size:19px;
				margin:0;
				color:var(--ink);
			}
			.roman {
				font-family:Fraunces, serif;
				font-weight:600;
				font-size:15px;
				color:var(--amber);
				letter-spacing:.06em;
			}
			.section-back { margin-left:auto; }
			.field-grid {
				display:grid;
				grid-template-columns:1fr 1fr;
				gap:18px 20px;
			}
			.field.span-2,
			.span-2 { grid-column:1 / -1; }
			.conditional-inner {
				background:var(--verified-soft);
				border:1px dashed #A9CFBE;
				border-radius:7px;
				padding:14px 16px;
				display:flex;
				flex-direction:column;
				gap:8px;
			}
			.conditional-inner label { font-size:12px; font-weight:600; color:#155940; }
			.active-toggle {
				display:flex !important;
				align-items:flex-start;
				gap:12px;
				border:1px solid var(--rule);
				background:#FDFCFA;
				border-radius:7px;
				padding:12px 14px;
				cursor:pointer;
			}
			.active-toggle input {
				width:16px;
				height:16px;
				margin-top:2px;
				flex:none;
				accent-color:var(--verified);
			}
			.active-toggle strong {
				display:block;
				font-size:13px;
				color:var(--ink);
				margin-bottom:2px;
			}
			.active-toggle small {
				display:block;
				font-size:12px;
				line-height:1.45;
				color:var(--slate);
			}
			.map-btn {
				margin-top:0;
				background:#fff;
				border:1.4px solid var(--ink);
				color:var(--ink);
				font-size:13.5px;
				font-weight:600;
				padding:10px 18px;
				border-radius:7px;
				display:inline-flex;
				align-items:center;
				gap:8px;
			}
			.map-btn:hover { background:var(--ink); color:#fff; }
			.preview-col {
				position:sticky;
				top:28px;
				display:flex;
				flex-direction:column;
				gap:16px;
			}
			.preview-card {
				background:var(--card);
				border:1px solid var(--rule);
				border-radius:var(--radius);
				box-shadow:var(--shadow);
				padding:22px 22px 24px;
			}
			.preview-card h2 {
				font-family:Fraunces, serif;
				font-size:16px;
				font-weight:600;
				color:var(--ink);
				margin:0 0 4px;
			}
			.preview-card .sub { font-size:12.5px; color:var(--slate); margin:0 0 18px; }
			.pf-actions {
				display:flex;
				align-items:center;
				gap:18px;
				margin-bottom:22px;
				flex-wrap:wrap;
			}
			.btn-add-block,
			.btn-save {
				background:var(--verified);
				color:#fff;
				border:none;
				font-weight:600;
				font-size:13.5px;
				padding:10px 16px;
				border-radius:7px;
			}
			.btn-add-block:hover,
			.btn-save:hover { background:#19624A; }
			.link-backup,
			.btn-cancel {
				background:none;
				border:none;
				color:var(--ink-2);
				font-size:13px;
				font-weight:600;
				text-decoration:underline;
				text-underline-offset:3px;
				padding:0;
			}
			.preview-divider {
				display:flex;
				align-items:center;
				gap:12px;
				margin-bottom:16px;
			}
			.preview-divider::before,
			.preview-divider::after {
				content:"";
				flex:1;
				height:1px;
				background:var(--rule);
			}
			.preview-divider span {
				font-family:"IBM Plex Mono", monospace;
				font-size:10px;
				letter-spacing:.18em;
				color:#B7B2A2;
			}
			.footer-bar {
				margin:36px 0 0;
				padding:22px 0 0;
				display:flex;
				align-items:center;
				justify-content:space-between;
				gap:16px;
				flex-wrap:wrap;
				border-top:1px solid var(--rule);
			}
			.footer-bar .note { font-size:12.5px; color:var(--slate); margin:0; }
			.footer-actions { display:flex; align-items:center; gap:20px; }
			.btn-save { font-size:14px; padding:11px 20px; }
			.list-filters {
				display:grid;
				grid-template-columns:minmax(220px, 1fr) minmax(180px, 220px) minmax(180px, 220px);
				gap:12px;
				padding:14px 20px;
				border-bottom:1px solid var(--rule);
				background:#fff;
			}
			.list-filters .field { margin-bottom:0; }
			.btn {
				appearance:none;
				border:1px solid var(--rule);
				background:var(--card);
				color:var(--ink);
				font-size:12.5px;
				font-weight:600;
				padding:9px 16px;
				border-radius:5px;
				cursor:pointer;
				display:inline-flex;
				align-items:center;
				gap:6px;
				box-shadow:0 1px 0 rgba(27,36,48,.04);
				transition:border-color .12s, background .12s, transform .12s;
			}
			.btn:hover { border-color:var(--ink); transform:translateY(-1px); }
			.btn-primary { background:#075985; color:#fff; border-color:#075985; }
			.btn-primary:hover { background:#0c4a6e; }
			.btn-verified { background:var(--verified); color:#fff; border-color:var(--verified); }
			.btn-verified:hover { background:#186b42; }
			.btn-ghost { background:transparent; border-color:transparent; color:var(--slate); }
			.btn-ghost:hover { color:var(--ink); border-color:var(--rule-strong); background:var(--card); }
			.btn-sm { padding:6px 12px; font-size:11.5px; }
			.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px 28px; }
			.card-body > .form-grid + .form-grid {
				margin-top:20px;
				padding-top:20px;
				border-top:1px solid var(--rule);
			}
			.field { margin-bottom:0; display:flex; flex-direction:column; gap:7px; }
			.field label {
				display:block;
				font-size:12.5px;
				font-weight:600;
				color:var(--ink-2);
				margin-bottom:0;
			}
			.field .hint { font-size:12.5px; color:var(--slate); margin-top:2px; line-height:1.5; }
			.field input[type=text],
			.field select,
			.field textarea {
				width:100%;
				border:1.4px solid var(--rule);
				border-radius:7px;
				padding:10px 13px;
				font-size:14.5px;
				font-family:inherit;
				background:#FDFCFA;
				color:var(--ink);
			}
			.ds-link-control-ready .form-group {
				margin: 0;
			}
			.ds-link-control-ready .control-label {
				display: none;
			}
			.ds-link-control-ready .link-field,
			.ds-link-control-ready input {
				border:1.4px solid var(--rule) !important;
				border-radius:7px !important;
				box-shadow:none !important;
				min-height:42px;
				font-size:14.5px;
			}
			.field textarea { resize:vertical; min-height:88px; }
			.field input:focus,
			.field select:focus,
			.field textarea:focus {
				border-color:var(--ink);
				outline:0;
				background:#fff;
				box-shadow:none;
			}
			.ds-search-field {
				position: relative;
				width: 100%;
			}
			.ds-search-results {
				display: none;
				position: absolute;
				top: calc(100% + 3px);
				left: 0;
				right: 0;
				z-index: 50;
				max-height: 230px;
				overflow: auto;
				background: #fff;
				border: 1px solid var(--rule-strong);
				border-radius: var(--radius);
				box-shadow: 0 12px 26px rgba(27,36,48,.14);
			}
			.ds-search-results.open { display: block; }
			.ds-search-option {
				width: 100%;
				border: 0;
				background: #fff;
				color: var(--ink);
				text-align: left;
				display: grid;
				gap: 2px;
				padding: 9px 10px;
				cursor: pointer;
				border-bottom: 1px solid var(--rule);
			}
			.ds-search-option:last-child { border-bottom: 0; }
			.ds-search-option:hover { background: #FCFBF6; }
			.ds-search-option span {
				font-size: 12.5px;
				font-weight: 600;
			}
			.ds-search-option small {
				font-size: 10.5px;
				color: var(--slate);
			}
			.ds-search-empty {
				padding: 10px;
				font-size: 12px;
				color: var(--slate);
			}
			.field-required label::after { content:" *"; color:var(--rust); }
			.check-row { display:flex; align-items:center; gap:8px; font-size:13px; }
			.check-row input { width:15px; height:15px; }
			.inline-msg {
				display:flex;
				flex-direction:column;
				gap:8px;
				font-size:11.5px;
				color:var(--slate);
				background:#F4F2EA;
				border:1px solid var(--rule);
				border-radius:var(--radius);
				padding:10px 12px;
				margin-top:8px;
			}
			.inline-msg .actions { display:flex; gap:8px; }
			.helper-card {
				border:1px dashed var(--rule-strong);
				background:#FCFBF8;
				padding:14px;
				color:var(--slate);
				font-size:12px;
				display:grid;
				gap:4px;
			}
			.helper-card strong { color:var(--ink-2); }
			.badge {
				display:inline-flex;
				align-items:center;
				gap:5px;
				font-size:10.8px;
				font-weight:600;
				padding:3px 9px;
				border-radius:20px;
			}
			.badge-dot { width:6px; height:6px; border-radius:50%; flex:none; }
			.badge-verified { background:var(--verified-soft); color:var(--verified); }
			.badge-verified .badge-dot { background:var(--verified); }
			.badge-amber { background:var(--amber-soft); color:var(--amber); }
			.badge-amber .badge-dot { background:var(--amber); }
			.badge-rust { background:var(--rust-soft); color:var(--rust); }
			.badge-rust .badge-dot { background:var(--rust); }
			.badge-slate { background:var(--slate-soft); color:var(--slate); }
			.badge-slate .badge-dot { background:var(--slate); }
			.sig-card {
				display:flex;
				gap:14px;
				align-items:center;
				background:#ECFDF5;
				border-left:3px solid var(--verified);
				border-radius:var(--radius);
				padding:13px 14px;
			}
			.sig-card.pending { background:var(--slate-soft); border-left-color:var(--slate); }
			.sig-card .qr {
				width:54px;
				height:54px;
				flex:none;
				background:#fff;
				border:1px solid var(--rule);
				border-radius:2px;
				display:grid;
				place-items:center;
			}
			.sig-card .qr.muted { background:var(--slate-soft); }
			.sig-card .top { font-size:11px; font-weight:700; letter-spacing:.03em; color:var(--verified); }
			.sig-card.pending .top { color:var(--slate); }
			.sig-card .name { font-family:Fraunces, serif; font-size:14.5px; font-weight:600; margin-top:3px; }
			.sig-card .desig { font-size:11px; color:var(--slate); }
			.sig-card .meta { font-size:10.5px; color:var(--slate); margin-top:3px; }
			.sig-card .hash { font-size:9.5px; color:#5C7A6B; margin-top:2px; word-break:break-all; }
			.preview-original {
				background:var(--verified-soft);
				border-left:4px solid var(--verified);
				border-radius:0 8px 8px 0;
				padding:16px 18px;
			}
			.preview-original .qr {
				width:54px;
				height:54px;
				border-radius:4px;
			}
			.signed-tag {
				font-family:"IBM Plex Mono", monospace;
				font-size:11px;
				font-weight:700;
				letter-spacing:.08em;
				color:var(--verified);
				margin-bottom:7px;
			}
			.signer-name {
				font-family:Fraunces, serif;
				font-weight:600;
				font-size:17px;
				color:var(--ink);
				margin:0 0 1px;
			}
			.signer-role { font-size:12.5px; color:var(--slate); margin:0 0 9px; }
			.doc-line { font-size:12px; color:var(--slate); margin:0 0 7px; }
			.preview-original .hash {
				font-family:"IBM Plex Mono", monospace;
				font-size:10.5px;
				color:var(--amber);
			}
			.divider-lbl {
				display:flex;
				align-items:center;
				gap:10px;
				margin:20px 0 12px;
				color:var(--slate);
				font-size:10.5px;
				letter-spacing:.07em;
				text-transform:uppercase;
			}
			.divider-lbl::before,
			.divider-lbl::after { content:""; flex:1; height:1px; background:var(--rule); }
			.checklist { display:flex; flex-direction:column; border:1px solid var(--rule); border-radius:var(--radius); overflow:hidden; }
			.checklist:empty { display:none; }
			.check-item { display:flex; align-items:center; gap:10px; padding:9px 12px; border-bottom:1px solid var(--rule); font-size:12.5px; }
			.check-item:last-child { border-bottom:none; }
			.check-item .fname { font-family:"IBM Plex Mono", monospace; font-size:11.5px; color:var(--ink-2); }
			.check-item .ftype { font-size:10.5px; color:var(--slate); margin-left:6px; }
			.check-item .status { margin-left:auto; }
			.setup-row {
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				gap: 16px;
				align-items: center;
				padding: 15px 20px;
				border-bottom: 1px solid var(--rule);
				cursor: pointer;
			}
			.setup-row:last-child { border-bottom: 0; }
			.setup-row:hover { background:#F8FAF9; }
			.setup-title { font-weight:700; font-size:13px; color:var(--ink); }
			.setup-meta { color:var(--slate); font-size:11.5px; margin-top:3px; }
			.setup-user { color:var(--ink-2); font-size:11.5px; margin-top:4px; }
			.setup-status { margin-left:auto; }
			.row-between { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
			.list-row { display:flex; align-items:center; gap:12px; padding:11px 20px; border-bottom:1px solid var(--rule); cursor:pointer; }
			.list-row:last-child { border-bottom:none; }
			.list-row:hover { background:#FCFBF6; }
			.list-row .seal { width:32px; height:32px; flex:none; border-radius:50%; }
			.list-row .lname { font-weight:600; font-size:13px; }
			.list-row .ldesig { font-size:11.5px; color:var(--slate); }
			.list-row .lright { margin-left:auto; }
			select.doc-select { max-width:280px; }
			.empty-state { padding:18px 20px; color:var(--slate); font-size:12.5px; }
			@media (max-width:900px) {
				.setup-layout { grid-template-columns:1fr; }
				.preview-col { position:static; }
				.field-grid { grid-template-columns:1fr; }
				.page-grid { grid-template-columns:1fr; }
				.side-card { position:static; }
			}
			@media (max-width:640px) {
				.form-grid { grid-template-columns:1fr; }
				.list-filters { grid-template-columns:1fr; }
				.setup-row { grid-template-columns:1fr; gap:8px; }
				.setup-status { margin-left:0; }
				.tabs { gap:2px; }
				.tab { padding:8px 12px; font-size:12px; }
				.topbar { gap:12px; padding:0 14px; }
				.topbar-spacer { display:none; }
				.content { padding:24px 14px 60px; }
			}
		`;
		document.head.appendChild(style);
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		}[char]));
	}

	function escapeAttr(value) {
		return escapeHtml(value).replace(/`/g, "&#096;");
	}
})();
