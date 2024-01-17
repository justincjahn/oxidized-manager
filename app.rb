require "roda"
require "yaml"
require "json"
require "securerandom"
require "net/http"
require "net/ldap"
require "sequel"

class App < Roda
    @@settings = YAML.load_file("config.yml")

    begin
        @@DB = Sequel.connect(@@settings["database"])

        @@DB.create_table? :devices do
            String :address, primary_key: true, size: 50
            String :name, size: 50, null: false
            String :type, size: 50, null: false
            String :username, size: 50
            String :password, size: 50
            String :enable, size: 50
            DateTime :created_at, null: false
            DateTime :updated_at
        end
    rescue => e
        STDERR.puts "Unable to open the database #{@@settings["Database"]}: #{e.message}."
        exit 1
    end

    plugin :environments
    plugin :public
    plugin :json
    plugin :halt
    plugin :render
    plugin :sessions, secret: SecureRandom.hex(32)
    plugin :route_csrf
    plugin :flash

    # Attempt to authenticate and authorize the user.  Returns true
    ## sets session["username"].
    def login(username, password)
        if self.class.development?
            if username == "test" and password == "test"
                session['username'] = "test"
                return true
            end
        end

        ldap = Net::LDAP.new(
            :host => @@settings["ldap"]["server"],

            :auth => {
                :method   => :simple,
                :username => @@settings["ldap"]["bindUser"],
                :password => @@settings["ldap"]["bindPassword"]
            }
        )

        result = ldap.bind_as(
            :base => @@settings["ldap"]["bindDN"],
            :filter => "(sAMAccountName=#{username})",
            :password => password
        )

        return false unless result

        authorized = false
        result.first[:memberOf] = [] if result.first[:memberOf].empty?
        result.first[:memberOf].each do |group|
            @@settings["ldap"]["allowedGroups"].each do |allowed|
                authorized = true if group.downcase.include? allowed.downcase
            end
        end

        return false unless authorized

        session['username'] = result.first[:samaccountname].first
        return true
    end

    # Ensures that the user is authorized or redirects to the login page
    def authorize!
        request.redirect "/login" unless session.key?('username')
    end

    # Ensures that the user is authorized or throws a JSON error and 401 code
    def authorize_json!
        request.halt(
            401,
            { "Content-Type" => "application/json" },
            { :error => "Unauthorized" }.to_json
        ) unless session.key?('username')
    end

    # Returns a URI object for the Oxidized API and provided endpoint
    def get_api_uri(endpoint)
        URI.join(@@settings["api"], endpoint)
    end

    # Fetch data from the Oxidized API using the provided URI
    def get_api_data(uri)
        begin
            res = Net::HTTP.get_response(uri)
        rescue => e
            STDERR.puts e

            request.halt(
                500,
                { "Content-Type": "application/json" },
                JSON(:error => 'Unable to contact the Oxidized API.  Is Oxidized running?')
            )
        else
            if res.is_a?(Net::HTTPSuccess)
                res.body
            end
        end
    end

    # Return all devices from the database enriched with Oxidized API data
    def get_nodes
        api_nodes = JSON.parse(get_api_data(get_api_uri("/nodes.json")))

        db_devices = @@DB[:devices].select(
            :name,
            :type,
            :address,
            :created_at,
            :updated_at
        ).all

        db_devices.map do |device|
            node = api_nodes.detect do |node|
                node["ip"] == device[:address]
            end

            {
                "name" => device[:name],
                "address" => device[:address],
                "type" => device[:type],
                "created_at" => device[:created_at],
                "updated_at" => device[:updated_at],
                "status" => !node.nil? ? node["status"] : "not_registered",
                "mtime" => !node.nil? ? node["mtime"] : "unknown",
                "time" => !node.nil? ? node["time"] : nil
            }
        end
    end

    # Return version information for a specific address
    def get_versions(address)
        versionsRaw = get_api_data(get_api_uri("node/version.json?node_full=#{address}"))
        versions = !versionsRaw.nil? ? JSON.parse(versionsRaw) : nil

        unless versions.nil?
            num = versions.count + 1

            versions = versions.map do |version|
                version['num'] = num -= 1
                version
            end
        end
    end

    # Return information for a specific node enriched with Oxidized API data
    def get_node(address)
        nodeRaw = get_api_data(get_api_uri("/node/show/#{address}.json"))
        node = !nodeRaw.nil? ? JSON.parse(nodeRaw) : nil

        if !node.nil? and node['last'].nil?
            node['last'] = {
                "status" => "never",
                "end" => nil
            }
        end

        device = @@DB[:devices].select(
            :address,
            :name,
            :type,
            :username,
            :created_at,
            :updated_at
        ).where(address: address).first

        return nil if device.nil?

        versions = get_versions(address)

        {
            "name" => device[:name],
            "address" => device[:address],
            "type" => device[:type],
            "created_at" => device[:created_at],
            "updated_at" => device[:updated_at],
            "status" => !node.nil? ? node['last']['status'] : "not_registered",
            "time" => !node.nil? ? node['last']['end'] : nil,
            "mtime" => !node.nil? ? node['mtime'] : nil,
            "versions" => !versions.nil? ? versions : []
        }
    end

    # Return the a specific config version from the Oxidized API
    def get_node_config(address, oid=nil, date=nil, num=nil)
        if oid.nil?
            rawData = get_api_data(get_api_uri("/node/fetch/#{address}"))
            return rawData
        else
            uri = get_api_uri('/node/version/view.json')

            urlParams = URI.encode_www_form(
                'node' => address,
                'group' => "",
                'oid' => oid,
                'date' => date,
                'num' => num
            )

            rawData = get_api_data(URI("#{uri}?#{urlParams}"))
        end

        data = JSON.parse(rawData)

        if data[0] == "version not found"
            return nil
        end

        data.join
    end

    # Tell the Oxidized API to reload the router database
    def reload_all
        get_api_data(get_api_uri('/reload.json'))
    end

    # Tell the Oxidized API to query a device for new configuration
    def reload_device(address)
        get_api_data(get_api_uri("/node/next/#{address}.json"))
    end

    route do |r|
        # Serve static files
        r.public

        # Throw an error on CSRF failure
        check_csrf!

        # Set the username for templates
        @username = session.key?('username') ? session['username'] : nil

        # /
        r.root do
            authorize!
            @devices = get_nodes
            view "index"
        end

        # /login
        r.on "login" do
            @title = "Login"

            # /login
            r.post do
                begin
                    result = login(r.params["username"], r.params["password"])
                rescue => e
                    @error = "An error occurred communicating with the authentication server."
                    return view "login"
                end

                unless result
                    @error = "Invalid username or password."
                    return view "login"
                end

                r.redirect "/"
            end

            r.get do
                view "login"
            end
        end

        # /logout
        r.get "logout" do
            r.session.clear
            r.redirect "/login"
        end

        # /devices
        r.on "devices" do
            authorize!

            # /devices/new
            r.get "new" do
                @device = {}
                view "device_form"
            end

            # /devices/reload
            r.get "reload" do
                reload_all
                flash["success"] = "Router database reloaded."
                r.redirect "/"
            end

            # /devices/:name
            r.on String do |name|
                # /devices/:name/config[?oid=&date=&num=]
                r.get "config" do
                    @config = get_node_config(
                        name,
                        r.params['oid'],
                        r.params['date'],
                        r.params['num']
                    )

                    @title = "#{name} Configuration"
                    @name = name

                    @date = r.params['date'].nil? ? DateTime.now
                        : DateTime.parse(r.params['date'])

                    return view "config" unless @config.nil?
                    halt 404
                end

                # /devices/:name/reload
                r.get "reload" do
                    r.halt 404 unless device = get_node(name)
                    reload_device(name)
                    flash["success"] = "Device #{device['address']} reloaded."
                    r.redirect "/"
                end

                # /devices/:name/edit
                r.get "edit" do
                    r.halt 404 unless @device = get_node(name)
                    @title = "Edit #{@device['name']}"
                    view "device_form"
                end

                # /devices/:name/delete
                r.get "delete" do
                    r.halt 404 unless @device = get_node(name)
                    view "delete"
                end

                # /devices/:name/delete
                r.post "delete" do
                    r.halt 404 unless device = get_node(name)
                    @@DB[:devices].where(address: name).delete
                    r.redirect "/"
                end

                # /devices/:name
                r.get do
                    r.halt 404 unless @device = get_node(name)
                    @title = "#{@device['name']} Details"
                    view "device"
                end

                # /devices/:name
                r.post do
                    device = @@DB[:devices].where(address: r.params['id']).first
                    halt 404 if device.nil?

                    errors = false

                    param_name = r.params["name"].strip
                    if param_name.empty?
                        flash["name"] = "A name is required."
                        errors = true
                    end

                    address = r.params["address"].strip
                    addr_regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/
                    unless addr_regex.match?(address)
                        flash["address"] = "Address must be a valid IP address."
                        errors = true
                    end

                    type = r.params["type"].strip
                    if type.empty?
                        flash["type"] = "A type is required."
                        errors = true
                    end

                    username = r.params["username"].strip
                    if type.empty?
                        flash["username"] = "A username is required."
                        errors = true
                    end

                    r.redirect "/devices/#{name}/edit" if errors

                    device[:name] = param_name
                    device[:address] = address
                    device[:type] = type
                    device[:username] = username
                    device[:updated_at] = DateTime.now

                    unless r.params["password"].strip.empty?
                        device[:password] = r.params["password"]
                    end

                    unless r.params["enable"].strip.empty?
                        device[:enable] = r.params["enable"]
                    end

                    @@DB[:devices].where(address: name).update(device)
                    r.redirect "/devices/#{address}"
                end
            end

            # /devices
            r.post do
                errors = false

                param_name = r.params["name"].strip
                if param_name.empty?
                    flash["name"] = "A name is required."
                    errors = true
                end

                address = r.params["address"].strip
                addr_regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/
                unless addr_regex.match?(address)
                    flash["address"] = "Address must be a valid IP address."
                    errors = true
                end

                type = r.params["type"].strip
                if type.empty?
                    flash["type"] = "A type is required."
                    errors = true
                end

                username = r.params["username"].strip
                if type.empty?
                    flash["username"] = "A username is required."
                    errors = true
                end

                r.redirect "/devices/new" if errors

                device = {}
                device[:name] = param_name
                device[:address] = address
                device[:type] = type
                device[:username] = username
                device[:created_at] = DateTime.now

                unless r.params["password"].strip.empty?
                    device[:password] = r.params["password"]
                end

                unless r.params["enable"].strip.empty?
                    device[:enable] = r.params["enable"]
                end

                @@DB[:devices].insert(device)
                r.redirect "/devices/#{address}"
            end
        end

        # /api
        r.on "api" do
            response.headers["Content-Type"] = "application/json"
            authorize_json!

            # /api/reload
            r.get "reload" do reload_all end

            # /api/nodes
            r.on "nodes" do
                # /api/nodes/:name
                r.on String do |name|
                    # /api/nodes/:name/versions
                    r.get "versions" do get_versions(name) end

                    # /api/nodes/:name/config[?oid=&date=&num=]
                    r.get "config" do
                        data = get_node_config(
                            name,
                            r.params['oid'],
                            r.params['date'],
                            r.params['num']
                        )

                        unless data.nil?
                            response.headers["Content-Type"] = 'text/plain'
                            return data 
                        end

                        halt 404
                    end

                    # /api/nodes/:name/reload
                    r.get "reload" do reload_device(name) end

                    # /api/nodes/:name
                    r.get do get_node(name) end
                end

                # /api/nodes
                r.get do get_nodes end
            end
        end
    end
end
