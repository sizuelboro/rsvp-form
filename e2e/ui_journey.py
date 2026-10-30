"""
End-to-end UI journey against the local Worker (wrangler dev serving the production build).
Covers: signup → template → editor (insert, edit, required, undo/redo, theme, logic, preview, publish, reload)
→ public submission on mobile → responses → event (assign form, CSV import, publish, invitations with
confirmation) → check-in → analytics, plus mobile overflow checks. Screenshots go to /tmp/shots.
"""
import json, os, random, re, string, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
SHOTS = "/tmp/shots"
os.makedirs(SHOTS, exist_ok=True)
uid = "".join(random.choices(string.ascii_lowercase, k=6))
EMAIL = f"jiu.{uid}@example.com"
errors = []
results = []

def step(name):
    print(f"• {name}", flush=True)
    results.append(name)

def shot(page, name, full=False):
    page.wait_for_timeout(350)
    page.screenshot(path=f"{SHOTS}/{name}.png", full_page=full)

def no_overflow(page, label):
    w = page.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    assert w[0] <= w[1] + 1, f"horizontal overflow on {label}: {w}"

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" and "fonts.g" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    # ── Sign up ──
    step("Sign up")
    page.goto(f"{BASE}/signup")
    shot(page, "01-signup")
    page.get_by_label("Your name").fill("Jiu Arya")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill("correct-horse-1")
    page.get_by_label(re.compile("Workspace name")).fill("Aryl Events")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("heading", name=re.compile("Good (morning|afternoon|evening), Jiu"))).to_be_visible(timeout=15000)
    shot(page, "02-overview-empty")

    # ── Templates ──
    step("Browse templates")
    page.get_by_role("link", name="Templates").click()
    expect(page.get_by_role("heading", name="Featured")).to_be_visible()
    shot(page, "03-templates")
    page.get_by_role("button", name="Preview Classic Wedding RSVP").first.click()
    expect(page.get_by_role("button", name="Use this template")).to_be_visible()
    shot(page, "04-template-preview")
    page.get_by_role("button", name="Use this template").click()

    # ── Editor ──
    step("Editor loads with the template")
    expect(page.get_by_label("Form name")).to_have_value("Sarah & John", timeout=15000)
    expect(page.get_by_label("Form title")).to_have_value("Sarah & John")
    shot(page, "05-editor")
    edit_url = page.url

    step("Insert a field by clicking and edit it in the inspector")
    page.get_by_role("button", name="Add Short text").click()
    label_box = page.get_by_role("complementary", name="Properties").get_by_label("Label")
    expect(label_box).to_be_visible()
    label_box.fill("Which side are you from?")
    page.get_by_role("complementary", name="Properties").get_by_role("switch", name="Required").click()
    expect(page.get_by_role("main", name="Canvas").get_by_text("Short text", exact=True)).to_be_visible()
    shot(page, "06-editor-field-selected")

    step("Autosave reaches 'Saved'")
    expect(page.get_by_text(re.compile(r"^Saved"))).to_be_visible(timeout=10000)

    step("Undo / redo")
    canvas = page.get_by_role("main", name="Canvas")
    page.locator("body").click(position={"x": 700, "y": 880})  # blur inputs
    page.get_by_role("button", name="Undo", exact=True).click()
    page.get_by_role("button", name="Undo", exact=True).click()
    page.get_by_role("button", name="Redo", exact=True).click()
    page.get_by_role("button", name="Redo", exact=True).click()

    step("Duplicate and delete via contextual toolbar")
    canvas.locator('[data-editor-el="short_text_1"]').click()
    page.get_by_role("button", name="Duplicate", exact=True).click()
    expect(canvas.locator('[data-editor-el="short_text_1_copy"]')).to_be_visible()
    page.get_by_role("button", name="Delete", exact=True).click()
    expect(canvas.locator('[data-editor-el="short_text_1_copy"]')).to_have_count(0)

    step("Theme change")
    page.get_by_role("button", name="Theme settings").click()
    page.get_by_role("button", name="Luxury theme").click()
    shot(page, "07-editor-theme-luxury")
    page.get_by_role("button", name="Romantic theme").click()

    step("Logic builder")
    page.get_by_role("button", name="Logic builder").click()
    expect(page.get_by_role("dialog", name="Conditional logic")).to_be_visible()
    shot(page, "08-logic-builder")
    page.get_by_role("button", name="Cancel").click()

    step("Preview (mobile + conversational)")
    page.get_by_role("button", name="Preview", exact=True).click()
    pv = page.get_by_role("dialog", name="Preview")
    expect(pv).to_be_visible()
    pv.get_by_role("radio", name="Mobile").click()
    shot(page, "09-preview-mobile")
    pv.get_by_role("radio", name="One-by-one").click()
    pv.get_by_role("button", name=re.compile("Start")).click()
    shot(page, "10-preview-conversational")
    pv.get_by_role("button", name="Close preview").click()

    step("Publish")
    expect(page.get_by_text(re.compile(r"^Saved"))).to_be_visible(timeout=10000)
    page.get_by_role("button", name="Publish", exact=True).click()
    page.get_by_role("dialog").get_by_role("button", name=re.compile("^Publish")).click()
    expect(page.get_by_text("Your form is live")).to_be_visible(timeout=15000)
    public_url = page.get_by_label("Public link").input_value()
    shot(page, "11-published-share")
    page.get_by_role("button", name="Done").click()

    step("Reload persists the draft")
    page.reload()
    expect(page.get_by_role("main", name="Canvas").get_by_text("Which side are you from?")).to_be_visible(timeout=15000)

    # ── Public form on a phone ──
    step("Public submission on mobile")
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
    mp = m.new_page()
    mp.on("pageerror", lambda e: errors.append(f"[public pageerror] {e}"))
    mp.goto(public_url)
    expect(mp.get_by_role("heading", name="Sarah & John")).to_be_visible(timeout=15000)
    no_overflow(mp, "public form")
    shot(mp, "12-public-form-mobile")
    mp.get_by_role("button", name="Send RSVP").click()
    expect(mp.get_by_text("Let us know if you can attend").first).to_be_visible()
    mp.get_by_label(re.compile("^Full name")).fill("Priya Sharma")
    mp.get_by_label(re.compile("^Email address")).fill(f"priya.{uid}@example.com")
    mp.get_by_label(re.compile("^Which side are you from")).fill("Bride")
    mp.get_by_text("Joyfully accept").click()
    mp.get_by_role("button", name="More adults").click()
    mp.get_by_text("Vegetarian", exact=True).click()
    shot(mp, "13-public-form-filled", full=True)
    mp.wait_for_timeout(1600)  # human-speed submission (bots under 1.5s are flagged)
    mp.get_by_role("button", name="Send RSVP").click()
    expect(mp.get_by_role("heading", name="Thank you, Priya Sharma!")).to_be_visible(timeout=15000)
    shot(mp, "14-public-confirmation")

    # ── Responses ──
    step("Response appears in the dashboard")
    page.goto(f"{BASE}/responses")
    expect(page.get_by_text("Priya Sharma").first).to_be_visible(timeout=10000)
    shot(page, "15-responses")
    page.get_by_text("Priya Sharma").first.click()
    expect(page.get_by_text("Which side are you from?")).to_be_visible()
    shot(page, "16-response-drawer")
    page.keyboard.press("Escape")

    # ── Event workflow ──
    step("Create an event")
    page.goto(f"{BASE}/events?new=1")
    page.get_by_label("Event name").fill("Sarah & John’s Wedding")
    page.locator('input[type="datetime-local"]').first.fill("2027-02-14T17:30")
    page.get_by_placeholder("The Leela Palace").fill("Lake Palace")
    page.get_by_role("button", name="Create event").click()
    expect(page.get_by_role("heading", name="Sarah & John’s Wedding")).to_be_visible(timeout=10000)
    shot(page, "17-event-overview")

    step("Assign the RSVP form")
    page.get_by_role("tab", name=re.compile("^Forms")).click()
    page.get_by_label("Form", exact=True).select_option(label="Sarah & John")
    page.get_by_role("button", name="Assign", exact=True).click()
    expect(page.get_by_text("Primary")).to_be_visible()

    step("Import guests from CSV with dedupe preview")
    page.get_by_role("tab", name=re.compile("^Guests")).click()
    page.get_by_role("button", name="Import CSV").first.click()
    page.get_by_placeholder(re.compile("Name,Email")).fill(
        f"Name,Email,Phone,Group\nRahul Verma,rahul.{uid}@example.com,,Friends\nAnita Rao,anita.{uid}@example.com,+91 90000 11111,Family\nanita dup,ANITA.{uid}@example.com,,\nWalk-in Guest,,+91 90000 22222,Friends\n")
    page.get_by_role("button", name="Preview import").click()
    expect(page.get_by_text("Duplicates skipped")).to_be_visible()
    shot(page, "18-import-preview")
    page.get_by_role("button", name=re.compile(r"^Import \d+ guests")).click()
    expect(page.get_by_text("Rahul Verma")).to_be_visible(timeout=10000)

    step("Publish event")
    page.get_by_role("button", name="Publish event").click()
    expect(page.get_by_role("button", name="Publish event")).to_have_count(0, timeout=10000)

    step("Send invitations requires explicit confirmation")
    page.get_by_role("button", name="Send", exact=True).click()
    page.get_by_role("menuitem", name="Invite everyone not yet invited").click()
    send_btn = page.get_by_role("dialog").get_by_role("button", name=re.compile(r"^Send invitations"))
    expect(page.get_by_text("Will receive email")).to_be_visible(timeout=10000)
    expect(send_btn).to_be_disabled()
    shot(page, "19-send-confirm")
    page.get_by_role("dialog").get_by_role("checkbox").check()
    expect(send_btn).to_be_enabled()
    send_btn.click()
    expect(page.get_by_text(re.compile(r"\d+ emails? queued"))).to_be_visible(timeout=10000)
    page.wait_for_timeout(6000)
    page.reload()
    page.get_by_role("tab", name=re.compile("^Guests")).click()
    expect(page.locator("tbody").get_by_text("Delivered").first).to_be_visible(timeout=15000)
    shot(page, "20-event-guests")

    step("Guest RSVPs through a personal invitation link")
    event_id = page.url.rstrip("/").split("/")[-1].split("?")[0]
    wid = page.evaluate("async () => (await (await fetch('/api/v1/auth/me')).json()).workspaces[0].id")
    guests = page.evaluate(f"""async () => (await (await fetch('/api/v1/w/{wid}/events/{event_id}/guests?search=Anita', {{headers: {{'x-requested-with': 'invitely'}}}})).json())""")
    invite_url = guests["items"][0]["rsvpUrl"]
    gp = m.new_page()
    gp.on("pageerror", lambda e: errors.append(f"[invite pageerror] {e}"))
    gp.goto(invite_url)
    expect(gp.get_by_label(re.compile("^Full name"))).to_have_value("Anita Rao", timeout=15000)
    expect(gp.get_by_label(re.compile("^Email address"))).to_have_value(f"anita.{uid}@example.com")
    gp.get_by_label(re.compile("^Which side are you from")).fill("Groom")
    gp.get_by_text("Joyfully accept").click()
    gp.get_by_text("Vegan", exact=True).click()
    gp.wait_for_timeout(1600)
    gp.get_by_role("button", name="Send RSVP").click()
    expect(gp.get_by_role("heading", name="Thank you, Anita Rao!")).to_be_visible(timeout=15000)
    expect(gp.get_by_alt_text("Check-in QR code")).to_be_visible()
    shot(gp, "21a-invitation-confirmation-qr")
    gp.goto(invite_url)
    expect(gp.get_by_role("heading", name="You’re attending")).to_be_visible(timeout=15000)

    step("Check-in from a phone")
    cp = m.new_page()
    cp.on("pageerror", lambda e: errors.append(f"[checkin pageerror] {e}"))
    cp.goto(f"{BASE}/events/{event_id}/checkin")  # anonymous phone → redirected to login, then back
    cp.get_by_label("Email").fill(EMAIL)
    cp.get_by_label("Password").fill("correct-horse-1")
    cp.get_by_role("button", name="Sign in").click()
    expect(cp.get_by_role("radio", name="Guest list")).to_be_visible(timeout=15000)
    assert "/checkin" in cp.url, cp.url
    cp.get_by_role("radio", name="Guest list").click()
    cp.get_by_placeholder("Search by name or email").fill("Anita")
    expect(cp.get_by_text("Anita Rao")).to_be_visible(timeout=10000)
    cp.get_by_role("button", name="Check in").first.click()
    expect(cp.get_by_text("Checked in", exact=True).first).to_be_visible(timeout=10000)
    no_overflow(cp, "check-in")
    shot(cp, "21-checkin-mobile")
    cp.get_by_role("button", name="Next guest").click()
    cp.get_by_placeholder("Search by name or email").fill("Rahul")
    cp.get_by_role("button", name="Check in").first.click()
    expect(cp.get_by_text("Needs confirmation")).to_be_visible(timeout=10000)
    shot(cp, "22-checkin-override")

    step("Event analytics separate accepted from checked-in")
    page.get_by_role("tab", name="Analytics").click()
    expect(page.get_by_text("Actual attendance", exact=True)).to_be_visible(timeout=10000)
    shot(page, "23-event-analytics", full=True)

    step("Dashboard pages")
    for path, name in [("/", "24-overview"), ("/forms", "25-forms"), ("/guests", "26-guests"), ("/analytics", "27-analytics"), ("/integrations", "28-integrations"), ("/settings/billing", "29-billing"), ("/settings/notifications", "30-emails")]:
        page.goto(f"{BASE}{path}")
        page.wait_for_load_state("networkidle")
        shot(page, name)

    step("Mobile layouts have no horizontal overflow")
    mobile_dash = m.new_page()
    for path in ["/", "/forms", "/events", f"/events/{event_id}", "/responses", "/guests", "/templates", "/analytics", "/settings/billing"]:
        mobile_dash.goto(f"{BASE}{path}")
        mobile_dash.wait_for_load_state("networkidle")
        mobile_dash.wait_for_timeout(300)
        no_overflow(mobile_dash, path)
    shot(mobile_dash, "31-mobile-billing")
    mobile_dash.goto(f"{BASE}/")
    mobile_dash.wait_for_load_state("networkidle")
    shot(mobile_dash, "32-mobile-overview")
    mobile_dash.goto(edit_url)
    expect(mobile_dash.get_by_label("Form title")).to_be_visible(timeout=15000)
    no_overflow(mobile_dash, "editor")
    shot(mobile_dash, "33-mobile-editor")

    browser.close()

print(json.dumps({"steps": len(results), "errors": errors}, indent=2))
sys.exit(1 if errors else 0)
