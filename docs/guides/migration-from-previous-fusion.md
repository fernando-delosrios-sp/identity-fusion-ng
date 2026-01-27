# Migration from Previous Identity Fusion Versions

This guide describes how to migrate from an earlier Identity Fusion connector to **Identity Fusion NG** with minimal disruption. The approach uses the existing (old) Fusion source as a **managed source** in the new setup, aligns schemas, then migrates identities to a new profile before decommissioning the old one.

---

## Overview

| Phase | Goal |
|-------|------|
| **1. Add Identity Fusion NG and the old source as managed** | New Fusion source uses the old Fusion as a managed source; no identity scope yet. |
| **2. Align schemas** | Account schemas between old and new Fusion differ slightly; align attribute mapping and definitions so the new Fusion accounts match what downstream systems expect. |
| **3. Validate new Fusion accounts** | Run aggregation; confirm new Fusion accounts are created and data looks correct. **Do not configure Fusion Settings** (matching/review) at this stage. |
| **4. New identity profile with higher priority** | Create a new identity profile for Identity Fusion NG with **higher priority** than the original Fusion identity profile. |
| **5. Identity refresh** | Run an identity refresh so existing Fusion identities migrate to the new profile. |
| **6. Decommission** | Once migration is verified, decommission the old identity profile and the old Fusion source. |

---

## Prerequisites

- Identity Fusion NG connector available in your ISC tenant (uploaded via SailPoint CLI or your organization’s process).
- Existing Identity Fusion (legacy) source and identity profile in place.
- Access to modify sources, identity profiles, and to run aggregation and identity refresh.

---

## Phase 1: Add Identity Fusion NG and configure the old source as managed

1. **Create a new source** in ISC using the **Identity Fusion NG** connector.
   - Do **not** mark it Authoritative yet (you will use it in attribute-generation style first to onboard accounts from the old Fusion).
2. **Configure Connection Settings** (ISC API URL, Personal Access Token).
3. **Source Settings → Scope**
   - Set **Include identities in the scope?** to **No** for now. You are not using identity scope in this phase; the new Fusion will only consume managed accounts from the old Fusion source.
4. **Source Settings → Sources**
   - Add the **old Identity Fusion source** as the only **Authoritative account sources** entry (or add it along with other sources if you already have a multi-source design in mind).
   - Configure **Source name** to match the old Fusion source name in ISC exactly (case-sensitive).
   - Do **not** enable **Force aggregation before processing?** unless you have a specific need; you can leave other per-source options as needed.
5. **Do not configure Fusion Settings** (Matching or Review) at this stage. Matching and review are for deduplication; migration first relies on the new connector producing Fusion accounts from the old source’s accounts.

**Result:** Identity Fusion NG is configured to read accounts from the old Fusion source as a managed source, with no identity scope, and no deduplication/matching settings.

---

## Phase 2: Align schemas

Account schemas between the previous Identity Fusion and Identity Fusion NG can differ (attribute names, types, or structure).

1. **Compare schemas**
   - In ISC, note the **account schema** of the old Fusion source (attributes, types, which are identity attributes, display attribute, etc.).
   - Run **Discover Schema** on the new Identity Fusion NG source.
   - Compare the discovered schema with the old one and with what your identity profiles and downstream systems expect.
2. **Configure Attribute Mapping and Attribute Definitions**
   - In Identity Fusion NG, use **Attribute Mapping Settings** and **Attribute Definition Settings** so that the new Fusion account attributes align with the old schema (or with your target schema).
   - Ensure critical attributes (e.g. native identity, display attribute, any attributes used in identity profile matching or provisioning) are present and correctly named/typed.
3. **Re-run Discover Schema** on the new source after changes, and confirm the schema in ISC matches expectations.

**Result:** The new Fusion source’s account schema is aligned so that once accounts are aggregated, they can be used by identity profiles and other processes in the same way as the old Fusion accounts.

---

## Phase 3: Validate new Fusion accounts (no Fusion Settings yet)

1. **Run account aggregation** on the **Identity Fusion NG** source.
   - Ensure the old Fusion source has been aggregated recently (or run its aggregation first) so the new connector has up-to-date managed accounts to process.
2. **Verify in ISC**
   - Check that Fusion accounts are created on the new source.
   - Spot-check account attributes, links to managed accounts, and any identifiers (e.g. native identity, display name) to ensure they match expectations and align with the old behavior.
3. **Leave Fusion Settings unconfigured**  
   Do not set up **Fusion attribute matches**, review forms, or “Automatically correlate if identical?” yet. This phase is only about getting the new Fusion accounts into the system and validating data.

**Result:** New Fusion accounts exist on Identity Fusion NG and look correct. You are ready to move identities to a new profile.

---

## Phase 4: New identity profile with higher priority

1. **Create a new identity profile** that uses the **Identity Fusion NG** source.
   - Configure lifecycle states, provisioning policies, and attribute mapping as required (aligned with how you use the old Fusion profile).
2. **Set this new identity profile’s priority higher than the original Fusion identity profile.**
   - In ISC, identity profile priority determines which profile owns an identity when multiple profiles could apply. By giving the new profile **higher priority**, a subsequent identity refresh will cause existing Fusion identities (currently on the old profile) to be evaluated against the new profile first and migrate to it when they match the new profile’s source/conditions.

**Result:** The new Identity Fusion NG profile exists and has higher priority than the old Fusion profile, so identities can move to it during refresh.

---

## Phase 5: Identity refresh to migrate identities

1. **Run an identity refresh** (organization-wide or scoped as appropriate).
   - Identities that match the new identity profile (and are now covered by its higher priority) will be **migrated to the new Identity Fusion NG profile**.
2. **Verify**
   - Confirm that identities that were previously on the old Fusion profile are now on the new profile and that their accounts and attributes are correct.
   - Check that no identities are left incorrectly on the old profile if they should have moved.

**Result:** Existing Fusion identities have been moved to the new Identity Fusion NG identity profile.

---

## Phase 6: Decommission the old profile and old Fusion source

1. **Confirm migration**
   - No critical identities remain on the old Fusion identity profile (or only those you intend to handle separately).
   - Reporting, access, and provisioning behaviors that depended on the old Fusion are now satisfied by the new Fusion source and profile.
2. **Decommission the old identity profile**
   - Remove or deactivate the old Identity Fusion identity profile per your change process.
3. **Decommission the old Fusion source**
   - Remove or deactivate the old Identity Fusion source and connector when it is no longer needed.
4. **Optional: Enable full Identity Fusion NG behavior**
   - If you need **deduplication**, set **Source Settings → Scope** (e.g. enable **Include identities in the scope?** and set **Identity Scope Query**) and configure **Fusion Settings** (Matching and Review) as described in [Identity Fusion for deduplication](deduplication.md).
   - If the new source should own the identity list, mark the Identity Fusion NG source as **Authoritative** and adjust the identity profile as needed.

**Result:** The previous Identity Fusion version is retired; Identity Fusion NG is the single Fusion source and profile in use.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Add Identity Fusion NG source; add old Fusion as a **managed source** only; **no identity scope**; **no Fusion Settings**. |
| 2 | Align account schemas (Attribute Mapping and Attribute Definitions) between old and new Fusion. |
| 3 | Run aggregation; validate new Fusion accounts; leave Fusion Settings unconfigured. |
| 4 | Create a new identity profile for Identity Fusion NG with **higher priority** than the old Fusion profile. |
| 5 | Run **identity refresh** to migrate existing Fusion identities to the new profile. |
| 6 | After verification, decommission the old identity profile and old Fusion source. |

**Next steps:**
- For attribute generation and mapping, see [Attribute generation](attribute-generation.md) and [Attribute management](attribute-management.md).
- For deduplication after migration, see [Identity Fusion for deduplication](deduplication.md).
- For connection and tuning, see [Advanced connection settings](advanced-connection-settings.md) and [Troubleshooting](troubleshooting.md).
