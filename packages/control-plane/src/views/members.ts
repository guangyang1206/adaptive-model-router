// ===========================================================================
// Settings › Members page BODY fragment (UIUX §6.6, Spec §6, Spec-critical ②).
// Returns a FRAGMENT (wrapped by renderAppShellHtml).
// Member table: avatar · name · email · role · status. Invite popover (owner).
//
// ROLE DROPDOWN (the critical part, ruling ②):
//   - owner / member are the ONLY active, selectable options.
//   - Admin / Viewer live in a DISABLED <optgroup label="Reserved for MVP-4+,
//     not active">; each <option disabled> is inherently non-focusable and
//     non-selectable, and is styled --text-muted (.role-select in styles.ts).
//     A visible Lucide-lock note reinforces "reserved, not active".
//   They must NOT look like shipped, selectable functionality.
// ===========================================================================

import { esc, escAttr, badge, avatar, stateBlock, button } from "./layout.js"
import { icon } from "./icons.js"
import { settingsTabs } from "./settings-tabs.js"
import type { MembersPageData, MemberRow } from "./contract.js"

const LOCK = icon("lock", 12)

function roleSelect(member: MemberRow): string {
  return (
    `<select class="select role-select" aria-label="Role for ${escAttr(member.name || member.email)}" data-user-id="${escAttr(member.userId)}" style="max-width:210px">` +
    `<optgroup label="Active roles">` +
    `<option value="owner"${member.role === "owner" ? " selected" : ""}>owner</option>` +
    `<option value="member"${member.role === "member" ? " selected" : ""}>member</option>` +
    `</optgroup>` +
    // Reserved tier — disabled group, non-selectable, muted. (Native <option>
    // cannot embed SVG; the lock is conveyed by the group label + the visible
    // Lucide-lock note below the table.)
    `<optgroup label="Reserved for MVP-4+, not active" disabled>` +
    `<option value="admin" disabled>Admin (locked — reserved)</option>` +
    `<option value="viewer" disabled>Viewer (locked — reserved)</option>` +
    `</optgroup>` +
    `</select>`
  )
}

function roleBadge(role: MemberRow["role"]): string {
  return role === "owner" ? badge("owner", "owner") : badge("member", "neutral")
}

function statusCell(status: MemberRow["status"]): string {
  return status === "invited" ? badge("invited", "warning") : badge("active", "success")
}

function reservedNote(): string {
  return (
    `<p class="text-xs dim" style="margin-top:12px;display:flex;align-items:center;gap:6px">` +
    `${LOCK}<span>Admin / Viewer are reserved for a future release (MVP-4+) and are not active in MVP-3. Only <strong>owner</strong> and <strong>member</strong> roles are enforced today.</span></p>`
  )
}

function table(members: MemberRow[], viewerIsOwner: boolean): string {
  const head = `<thead><tr><th>member</th><th>email</th><th>role</th><th>status</th></tr></thead>`
  const body = members
    .map((m) => {
      const nameCell = `<span class="by">${avatar(m.name, m.email)}<span class="text-sm">${esc(m.name || "—")}</span></span>`
      // Owners can change others' roles; the owner's own row stays a static badge.
      const roleCell = viewerIsOwner && m.role !== "owner" ? roleSelect(m) : roleBadge(m.role)
      return (
        `<tr>` +
        `<td>${nameCell}</td>` +
        `<td class="mono text-sm">${esc(m.email)}</td>` +
        `<td>${roleCell}</td>` +
        `<td>${statusCell(m.status)}</td>` +
        `</tr>`
      )
    })
    .join("")
  return `<div class="table-wrap"><table class="data">${head}<tbody>${body}</tbody></table></div>` + reservedNote()
}

function invitePopover(viewerIsOwner: boolean): string {
  if (!viewerIsOwner) return ""
  return `
<details class="invite-pop" style="position:relative">
  <summary class="btn btn-primary" style="list-style:none;cursor:pointer">${icon("userPlus", 20)}Invite</summary>
  <div class="card" style="position:absolute;right:0;top:calc(100% + 8px);width:320px;z-index:20;box-shadow:var(--shadow-elev)">
    <h3 style="margin-bottom:12px">Invite a teammate</h3>
    <form method="post" action="/api/orgs/current/invites" novalidate>
      <div class="field">
        <label for="invite-email">Email address</label>
        <input class="input" id="invite-email" name="email" type="email" required placeholder="teammate@company.com" />
        <span class="hint">They'll join as a <strong>member</strong>. You can promote to owner later.</span>
      </div>
      ${button("Send invite", { variant: "primary", type: "submit", iconName: "mail", block: true })}
    </form>
  </div>
</details>`
}

const MEMBERS_CLIENT = `<script>
(function(){
  document.querySelectorAll('.role-select[data-user-id]').forEach(function(sel){
    sel.addEventListener('change',async function(){
      var role=sel.value;
      if(role!=='owner'&&role!=='member'){sel.value='member';return;} // reserved never applies
      try{
        await window.cpApi('/api/orgs/current/members/'+encodeURIComponent(sel.getAttribute('data-user-id')),
          {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({role:role})});
        window.cpToast&&window.cpToast('Role updated');
      }catch(err){window.cpToast&&window.cpToast(err.message||'Update failed');}
    });
  });
})();
</script>`

export function renderMembersPageBody(data: MembersPageData): string {
  const head =
    `<div class="page-head"><div><h1>Members</h1><p>People in this organization and their access level.</p></div>` +
    `<div>${invitePopover(data.viewerIsOwner)}</div></div>` +
    settingsTabs("members")

  let inner: string
  if (!data.members || data.members.length === 0) {
    inner = stateBlock({
      kind: "empty",
      glyph: "users",
      title: "No teammates yet",
      description: data.viewerIsOwner
        ? "Invite people to view this organization's routing decisions together."
        : "Ask an owner to invite teammates to this organization.",
      actions: data.viewerIsOwner
        ? button("Invite a teammate", { variant: "primary", href: "#", iconName: "userPlus", attrs: "onclick=\"var d=document.querySelector('.invite-pop');if(d)d.open=true;return false;\"" })
        : undefined,
    }) + reservedNote()
  } else {
    inner = table(data.members, data.viewerIsOwner) + MEMBERS_CLIENT
  }

  return head + inner
}
