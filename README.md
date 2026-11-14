# AtlasCore

Atlas helps me use the web on purpose. It adds a little space between wanting
to visit a site and spending the next hour there.

## How it works, and why

The idea is simple: decide what you want easy access to when you're thinking
clearly, then let those decisions guide your browsing.

- **Whitelist:** sites you can open freely.
- **Blacklist:** sites you've chosen to block.
- **Greylist:** everything else. Wait, then explicitly start a limited period
  of access. The deadline doesn't keep moving as you browse.
- **Vault:** a waiting period and confirmation for adding permissions or
  changing protected settings. Removing an existing Whitelist permission can
  take effect after review without waiting.

Journeys let normal sign-in redirects work without permanently allowing every
site involved. Pins, bookmarks and themes make things easier to use; they don't
grant access. AtlasCore makes the decisions, and the Firefox extension carries
them out. It's a tool for keeping your own intentions, not a replacement for
Firefox's security or a way to control someone else's browsing.

## Get it for Firefox

Follow the short [Firefox setup guide](extension/README.md#build-and-load) to
build Atlas and load it through Firefox's **Load Temporary Add-on** option.
Temporary installs last until Firefox closes. For everyday use, install a
Mozilla-signed `.xpi` supplied by the project maintainer.

## How it's made

This project is developed mostly with Codex. I provide the direction, test it
in daily use, and shape the philosophy and design of the application.

Working on the code? Start with the [developer guide](docs/README.md).
