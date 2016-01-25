# Oxidized Manager

A web application to manage devices for the [Oxidized Network Configuration Manager](https://github.com/ytti/oxidized).

## Installing oxidized and oxidized-manager

Oxidized itself is very easy to install and update because it's published as a ruby gem. Please refer to the
installation documentation available in the [Oxidized Readme File](https://github.com/ytti/oxidized#installation)
for more detailed documentation than provided here.

Please note that the instructions below were designed and tested for CentOS 7.  There is no reason oxidized-manager
wouldn't run on other distributions, however.

### 1. Install system dependencies

    sudo yum install cmake sqlite-devel openssl-devel

### 2. Install oxidized gems

    sudo gem install oxidized
    sudo gem install oxidized-script oxidized-web sequel sqlite3

### 3. Create an unpriveleged user

    useradd --shell /sbin/nologin -m oxidized

### 4. Clone the oxidized-manager repository

    sudo su - # Unless non-root users have access to the Oxidized home directory.
    cd /home/oxidized
    sudo -u oxidized -H git clone git@github.com:justinjahn/oxidized-manager.git

### 5. Copy the oxidized systemd service file

The `systemd` file that `oxidized` comes with runs the application as the `root` user, which is not ideal.
oxidized-manager comes with one a little bit better, running oxidized as the user created earlier:

    sudo cp oxidized-manager/share/oxidized.service /etc/systemd/system/oxidized.service

### 6. Enable oxidized, and perform the first run

Then oxidized first runs, it will create a configuration file, `/home/oxidized/.config/oxidized/config` that must be
modified:

    systemctl enable oxidized
    systemctl start oxidized

### 7. Modify the auto-generated configuration file

    sudo -u oxidized -H vi /home/oxidized/.config/oxidized/config

Edit the configuration file to look similar to the config below.  Note that the important bits for `Oxidized-Manager` are
the `rest` and `source` sections.

    ---
    username: username
    password: password
    model: junos
    interval: 3600
    log: /home/oxidized/.config/oxidized/log
    debug: false
    threads: 30
    timeout: 20
    retries: 3
    prompt: !ruby/regexp /^([\w.@-]+[#>]\s?)$/
    rest: 127.0.0.1:8888
    vars: {}
    groups: {}
    input:
      default: ssh, telnet
      debug: /tmp/oxidized-debug
      ssh:
        secure: false
    output:
      default: git
      git:
        user: oxidized
        email: oxidized@my-server.local
        repo: /home/oxidized/network-config
    source:
      default: sql
      csv:
        file: /home/oxidized/.config/oxidized/router.conf
        delimiter: !ruby/regexp /:/
        map:
          name: 0
          model: 1
          username: 2
          password: 3
        vars_map:
          enable: 4
        sql:
          adapter: sqlite
          database: /home/oxidized/.config/router.db
          table: devices
          map:
            name: address
            model: type
            username: username
            password: password
          vars_map:
            enable: enable
    model_map:
      cisco: ios
      juniper: junos

#### 7.1. Post-Commit Hooks

Fun fact! `Oxidized` can run arbitrary commands after commit:

    hooks:
      post-commit-push:
        type: exec
        events: [post_store]
        cmd: 'cd /home/oxidized/network-config && git push origin master'
        async: true
        timeout: 120

Just add the necessary remote(s), and make sure the proper SSH keys are installed under the `oxidized` user.

### 8. Installing dependencies

The `bundler` gem is the only global dependency required:

    sudo gem install bundler

    cd oxidized-manager # Your current working directory should still be /home/oxidized from step 4.
    sudo -u oxidized -H bundle install --without development

#### 8.1. Command Not Found: bundle

This can occur because the `/usr/local/bin` path is not in the sudoers file.  On most modern distributions,
the `$PATH` variable is overwritten when running `sudo`.  Use the `visudo` command as `root` to edit the
`Defaults secure_path` section to fix this.

### 9. Copy and edit the configuration file

    sudo -u oxidized -H cp config/config.yml.dist config/config.yml
    sudo -u oxidized -H vi config/config.yml

Note that the `database` config entry should point to whatever file you specified in the
[Installing Oxidized](#4-clone-the-oxidized-manager-repository) section.  Fill in the `ldap` section with
your domain information, and the credentials of an __unprivileged__ user.

### 10. Copy the systemd service file

    sudo cp share/oxidized-manager.service /etc/systemd/system/oxidized-manager.service

### 11. Enable and start oxidized-manager

    sudo systemctl enable oxidized-manager
    sudo systemctl start oxidized-manager

### 12. Accessing the application

The web interface may be accessed via `http://{server-ip}:4567/` without any additional steps if the proper firewall
configuration is used.  If you wish to serve `oxidized-manager` on port 80, there are a few options:

#### Option 1: Configure Firewall

Non-root users cannot open ports below 1024.  While there are _production-ready_ solutions for this, such as using nginx to proxy
the `oxidized-manager` application, it isn't necessary for low-volume applications such as this.  To get around this issue, one can
use `firewall-cmd` to redirect port 80 traffic to Sinatra's default port (4567):

    sudo firewall-cmd --set-default-zone=public
    sudo firewall-cmd --zone=public --add-masquerade --permanent
    sudo firewall-cmd --zone=public --add-forward-port=port=80:proto=tcp:toport=8080 --permanent
    sudo firewall-cmd --reload

#### Option 2: Install and configure NGINX

Install and configure NGINX (outside the scope of this article), and use a configuration similar to this:

    upstream app {
      server 127.0.0.1:4567 fail_timeout=0;
    }

    server {
      listen 80;
      root /home/oxidized/oxidized-manager/public;
      try_files $uri/index.html $uri @app;

      location @app {
        proxy_pass http://app;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $http_host;
        proxy_redirect off;
      }

      client_max_body_size 4G;
      keepalive_timeout 10;
    }

## Updating Oxidized-Manager

### 1. Stop the web application

    sudo systemctl stop oxidized-manager

### 2. Backup the device database

Copy your SQLite database somewhere safe in case things go south.  Reference the `config.yml` file if you've forgotten
where the database is located.

### 3. Get the latest code

    sudo su - # Unless non-root users have access to the Oxidized home directory.
    cd /home/oxidized/oxidized-manager
    sudo -u oxidized -H git fetch --all
    sudo -u oxidized -H git checkout -- Gemfile.lock
    sudo -u oxidized -H git checkout master

### 4. Check for configuration changes

Take a quick peek at `config/config.yml.dist` to make sure no new settings are available.  If they are, add them to your
config.

### 5. Copy the latest systemd file

    sudo cp share/oxidized-manager.service /etc/systemd/system/oxidized-manager.service
    sudo systemctl daemon-reload

### 6. Start the application

    sudo systemctl start oxidized-manager