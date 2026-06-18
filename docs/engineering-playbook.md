# Engineering Playbook

## Core rule

Context must survive tool changes, account changes and conversation loss.

## Required habits

1. Update docs when the system shape changes.
2. Update ADRs when a structural decision is made.
3. Keep runbooks close to the real execution path.
4. Prefer markdown files in the repository over chat-only memory.

## Tool roles

### Obsidian

- vision
- architecture notes
- product rules
- roadmap
- runbooks

### Codex

- implementation
- migrations
- edge functions
- scripts
- reviews

### Claude

- product reasoning
- architecture critique
- decomposition
- writing assistance

### VS Code

- manual editing
- debugging
- repository control

### Vercel

- frontend delivery
- user-facing experience

### Supabase

- canonical data
- automation
- backend workflows

## Definition of done

Work is not done when code compiles. It is done when:

- implementation exists
- validation happened
- documentation reflects the current reality
- another person or agent can continue from repository context alone
