# Security

This is how to report a security problem in Superforge Foundation, the
template (<https://github.com/superforge-studio/foundation>), or in
what every copy of it gets from it.

**Report a vulnerability privately**, through GitHub's private
vulnerability reporting: on the repository, Security → Report a
vulnerability
(<https://github.com/superforge-studio/foundation/security/advisories/new>).
Never in a public issue, a pull request or a discussion, which anyone can
read before a fix is out.

Say what's affected (the release, from `.superforge/superforge.json`'s
`version`, and the files), how to reproduce it, and what it lets someone
do. A fix ships as a release of the template, with its notes in
`.superforge/releases/`, which every copy takes by updating
(`workbench/updating.md`).

A problem in a copy's own code, the business's, is that business's to
fix, not the template's.

This file is the template's alone: a copy never keeps it
(`.superforge/template-only`).
