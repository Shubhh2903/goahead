### Fixed

- GoAhead now stops at startup with a clear message when its data folder holds a database that
  OpenBot made, and does not change that database. Before, GoAhead tried to upgrade it and stopped
  with a migration error.

### Changed

- The database upgrade lets a later GoAhead version add an agent provider with no table rebuild.
  All provider sessions and their links to turns stay the same.
