require 'rubygems'
require 'bundler/setup'
require 'sinatra/base'
require 'sinatra/config_file'
require 'sinatra/json'
require 'sass'
require 'sass/plugin/rack'
require 'net/ldap'
require 'data_mapper'
require 'json'
require 'net/http'
require 'uri'

# A Sinatra application to handle CRUD operations on a database designed for the Oxidized NCM.
class OxidizedManager < Sinatra::Base
  # Do some things differently if we are developing.  Order is important here, as the other configure
  ## block sets up the database.
  configure :development do
    # Disable caching
    set :static_cache_control, [:public, max_age: 60 * 60 * 24 * 365]

    # Log database queries
    DataMapper::Logger.new($stdout, :debug)
  end

  # Initial configuration of database, configuration file, etc.
  configure do
    # Use Pool sessions, as storing login information on the server prevents
    ## users from just logging themselves in with fake data.
    use Rack::Session::Pool

    # Dynamically compile SASS
    Sass::Plugin.options[:style]             = :compressed
    Sass::Plugin.options[:template_location] = './sass'
    Sass::Plugin.options[:css_location]      = './public/css'
    use Sass::Plugin::Rack

    # Sinatra's configuration file extension
    register Sinatra::ConfigFile

    # Specify the configuration file
    config_file 'config/config.yml'

    # Load the database itself
    DataMapper.setup(:default, settings.database)

    # Load all DataMapper models
    Dir.glob('./models/**/*.rb').each do |file|
      require file
    end

    # Update the tables (if necessary)
    DataMapper.finalize.auto_upgrade!
  end

  # Create some helpers to manage authn and authz.
  helpers do
    # Verify that the user is authenticated, and authorized to view the page.  For this site
    # a valid user is authorized to access everything.
    def authorize!
      return if Sinatra::Base.development? || Sinatra::Base.test?

      unless session[:distinguishedName]
        halt 401, {'Content-Type' => 'text/json'}, json(:error => "Unauthorized!")
      end
    end
  end

  # Display the index page.
  get '/' do 
    File.read(File.join('public', 'index.html'))
  end

  #
  # DEVICES
  #

  # Make sure all of the CRUD actions require logins and that they have a JSON content type.
  before '/devices*' do
    authorize!
    content_type :json
  end

  # CREATE
  post '/devices' do
    params = (JSON.parse(request.body.read)).reject { |k, v| v.nil? || v.to_s.empty? }
    device = Device.new(params);

    if device.save
      device.to_json(:exclude => [:password, :enable])
    else
      status 500
      json :errors => device.errors.full_messages
    end
  end

  # READ
  get '/devices' do
    content = Device.all
    content.to_json(:exclude => [:password, :enable])
  end

  # RELOAD
  get '/devices/reload' do
    begin
      uri = URI.join(settings.api, '/reload.json')
    rescue
      status 500
      return json :error => "Unable to parse the Oxidized API URL.  Please check the Oxidized Manager config.yml file."
    end

    begin
      res = Net::HTTP.get_response(uri)
    rescue StandardError, Timeout::Error => e
      status 500
      json :error => "Unable to contact the Oxidized API. Is Oxidized running?"
    else
      status 200
      '{}'
    end
  end

  # QUEUE
  # Proxies the backend oxidized-web api to enqueue a device.
  get '/devices/reload/:device' do |device|
    unless device.match Device::ADDRESS_FORMAT
      status 500
      return json :error => "Device name is invalid.  Please double check that the device name is correct."
    end

    begin
      uri = URI.join(settings.api, "/node/next/#{device}.json")
    rescue
      status 500
      return json :error => "Unable to parse the Oxidized API URL.  Please check the Oxidized Manager config.yml file."
    end

    begin
      res = Net::HTTP.get_response(uri)
    rescue StandardError, Timeout::Error => e
      status 500
      json :error => "Unable to contact the Oxidized API. Ix Oxidized running?"
    else
      if res.is_a?(Net::HTTPSuccess)
        status 200
        '{}'
      else
        status 500
        json :error => "An unknown error occurred while accessing the Oxidized API.  Please check log files."
      end
    end
  end

  # STATUS
  # Proxies the backend oxidized-web api to fetch node status.
  get '/devices/status' do
    begin
      uri = URI.join(settings.api, '/nodes/stats.json')
    rescue
      status 500
      return json :error => "Unable to parse the Oxidized API URL.  Please check the Oxidized Manager config.yml file."
    end

    begin
      res = Net::HTTP.get_response(uri)
    rescue StandardError, Timeout::Error => e
      status 500
      json :error => "Unable to contact the Oxidized API. Ix Oxidized running?"
    else
      if res.is_a?(Net::HTTPSuccess)
        status 200
        res.body
      else
        status 500
        json :error => "An unknown error occurred while accessing the Oxidized API.  Please check log files."
      end
    end
  end

  # READ
  get '/devices/:id' do |id|
    device = Device.get(id)

    halt 404 unless device
    device.to_json(:exclude => [:password, :enable])
  end

  # UPDATE
  put '/devices/:id' do |id|
    params = (JSON.parse(request.body.read)).reject { |k, v| v.nil? || v.to_s.empty? }

    device = Device.get(id)
    halt 404 unless device

    if device.update(params)
      device.to_json(:exclude => [:password, :enable])
    else
      status 500
      json device.errors.full_messages
    end
  end

  # DELETE
  delete '/devices/:id' do |id|
    device = Device.get(id)

    halt 404 unless device
    halt 500 unless device.destroy!

    '{}'
  end

  # Utility to verify that a user is or isn't logged in.
  get '/check-login' do
    authorize!
    json(:displayName => session[:displayName])
  end

  # Clear the user's session, logging them out.
  get '/logout' do
    session.clear
    redirect '/'
  end

  # Tries to perform an LDAP bind with the provided credentials, and sets some `session`
  # variables if there is success.
  post '/login' do
    begin
      user = params[:username][/\A[\w\!\#]+/].downcase
    rescue
      status 500
      return json :error => "Invalid username, please double check that it is correct."
    end

    ldap = Net::LDAP.new(
      :host => settings.ldap[:server],

      :auth => {
        :method   => :simple,
        :username => settings.ldap[:bindUser],
        :password => settings.ldap[:bindPassword]
      }
    )

    begin
      result = ldap.bind_as(
        :base     => settings.ldap[:bindDN],
        :filter   => "(sAMAccountName=#{user})",
        :password => params[:password]
      )
    rescue Net::LDAP::Error => e
      status 500
      return json :error => e.to_s
    end

    # The user is authenticated, move on to authorization
    if result
      # Some users don't have any group memberships!
      result.first['memberOf'] = [''] if result.first['memberOf'].empty?

      # Loop through the user's groups to make sure they are authorized
      authorized = false
      result.first['memberOf'].each do |group|
        settings.ldap[:allowedGroups].each do |allowed|
          authorized = true if group.downcase.include? allowed.downcase
        end
      end

      if !authorized
        status 403
        return json :error => "Sorry, you are not allowed to access this web application."
      end

      # Set some session variables to keep track of the user.
      session[:distinguishedName] = result.first.distinguishedName.first
      session[:displayName]       = result.first.displayName.first
      session[:givenName]         = result.first.givenName.first
      session[:memberOf]          = result.first.memberOf

      # Send the user's display name for awesome UX.
      json :displayName => result.first.displayName.first
    else
      status 401
      json :error => "Unknown user and/or bad password."
    end
  end

  # Start the server if ruby file executed directly
  run! if app_file == $0
end
