# Security Policy

## Supported versions

Netherstone is in early development, so only the latest release gets
security fixes. Fixes ship as a new release, and the app's built-in updater
offers it to you automatically.

| Version                                  | Supported          |
| ---------------------------------------- | ------------------ |
| Latest release (including pre-releases)  | :white_check_mark: |
| Anything older                           | :x:                |

If you are on an older version, update first and check whether the problem
is still there.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a
security problem.**

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/Netherstone-HQ/Netherstone/security/advisories/new).
Only the maintainers can see it.

A useful report includes:

- the Netherstone version and your OS
- what an attacker can do, and what they need first (for example, getting
  you to open a file or a vault they made)
- steps to reproduce, or a proof of concept
- any fix you would suggest

### What happens next

- **Within 7 days:** we confirm we have received your report.
- **At least every 14 days:** we tell you how the investigation is going.
- **If we accept it:** we fix it, publish a release, and then publish a
  GitHub security advisory. We will agree a disclosure date with you, aiming
  for no more than 90 days after your report. Unless you would rather stay
  anonymous, we credit you in the advisory.
- **If we decline it:** we explain why. If you disagree, reply with more
  detail and we will look again.

Please give us the chance to release a fix before you share details
publicly.

## Scope

Netherstone is a desktop app that opens folders of Markdown files, can sync
them to the user's own GitHub repository, and updates itself. We are most
interested in:

- **Untrusted content.** A shard, attachment or vault from someone else
  running code, reading or writing files outside the vault, or reaching the
  app's internal commands.
- **GitHub sign-in and sync.** The GitHub token leaking, being stored
  somewhere other than intended, or being sent anywhere but GitHub. Sync
  pushing to the wrong repository, or losing or exposing files.
- **Updates.** Any way to make the app install an update that we did not
  sign.
- **Releases and the build pipeline.** Anything that could tamper with the
  installers published on the Releases page.

Out of scope:

- attacks that need someone already in control of your user account or
  device
- builds that someone else has modified
- problems in GitHub itself (report those to
  [GitHub](https://bounty.github.com/))
- vulnerabilities in a dependency that Netherstone's use of it does not
  expose (report those upstream). If Netherstone *is* affected, report it
  here.

## Safe harbor

We will not take legal action against you for research done in good faith
under this policy. That means not touching other people's data, not
disrupting services, and giving us reasonable time to fix the problem before
you disclose it.

There is no bug bounty, but we are grateful for every report.
