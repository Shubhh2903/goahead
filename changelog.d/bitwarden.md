### Added

- Connect Bitwarden in Marketplace or Server settings to fill browser passwords and authenticator codes in GoAhead. Share logins through a folder named `Shared with OpenBot`. The CLI session lasts until disconnect, eight idle hours, or app exit.

### Security

- Bitwarden fills require an exact HTTPS origin and a current item in the shared folder. GoAhead does not save session keys or login values, and redacts short authenticator codes from logs.
