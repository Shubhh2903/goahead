Pod::Spec.new do |s|
  s.name           = 'OpenBotAppIcon'
  s.version        = '1.0.0'
  s.summary        = 'App icon selection for GoAhead'
  s.description    = 'Reads and selects the alternate app icon that the user selects in Settings.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'GoAhead'
  s.homepage       = 'https://goahead.multicodegenius.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
