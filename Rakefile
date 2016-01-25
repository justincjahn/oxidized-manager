require 'bundler/setup'
require 'rake'
require 'fileutils'

task :clean_css do
  FileUtils.rm_r '.sass-cache' if Dir.exist?('.sass-cache')
  File.unlink 'public/css/site.css' if File.exist?('public/css/site.css')
  File.unlink 'public/css/site.css.map' if File.exist?('public/css/site.css.map')
end

# Metatasks
task :clean => [:clean_css]
