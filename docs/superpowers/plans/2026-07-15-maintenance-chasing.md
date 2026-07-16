# Maintenance Chasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal (owner-approved batch, 2026-07-15):** open maintenance items get chased, seen and quoted — (1) optional follow-up due date on open entries → portal calendar + amber/red aging; (2) dashboard "Open maintenance" rollup card; (3) "Quote this" on open entries creating a linked draft quote; (+) office can delete a bad evidence photo. Property-care PDF deferred.

**Architecture:** migration 0053 adds `follow_up_due date` + `quote_id uuid` to maintenance_entries and recreates `portal_calendar` (adds maintenance due events, full-scope links only) and `portal_site_detail` (maintenance array gains follow_up_due). `createQuoteFromMaintenance` in lib/maintenance.ts (admin/office; nextNumber; title "Permanent repair — {title}"; client/site from the entry's site; pm = creator; stamps entry.quote_id; returns quote id for redirect). Dashboard card mirrors the existing attention-card loaders. Aging: due within 30d amber, overdue red (same visual language as compliance lights).

**Tasks:** 1 (Fable) migration+zod+actions; 2 office section (due input, aging chip, Quote this button, evidence delete X via deleteAttachment); 3 field form due input when temporary ticked; 4 dashboard card; 5 portal due-date display; 6 verify live after paste (due date on Seal manhole via office edit → dashboard card shows it → portal calendar/tab shows due → quote-this on a zz entry → cleanup), push, deploy, memory.
