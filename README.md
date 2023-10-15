# Oxidized Manager

A web application to manage devices for the
[Oxidized Network Configuration Manager](https://github.com/ytti/oxidized). The
Oxidized API does not have any authentication mechanism nor any mechanism to
manage the router database. This application works by sharing an SQLite3
database with Oxidized and querying the Oxidized Web API.

## Installation

Oxidized itself is very easy to install and update because it's published as a
ruby gem. Please refer to the installation documentation available in the
[Oxidized Readme File](https://github.com/ytti/oxidized#installation) to get
Oxidized up and running.

The following instructions assume that oxidized is run as the user `oxidized`
in the `/home/oxidized/.config/oxidized` path.

### Install system dependencies

```shell
sudo apt install cmake libsqlite3-dev libssl-dev libyaml-dev
```

### Clone the repo

```shell
sudo -u oxidized -H git clone https://github.com/justincjahn/oxidized-manager.git /home/oxidized/oxidized-manager
```

### Modify the oxidized configuration file

Edit the configuration file's `source` setting and ensure the rest API is enabled
at `127.0.0.1:8888`:

```yaml
rest: 127.0.0.1:8888
source:
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
```

### Install dependencies

Make sure bundler is installed:

```shell
sudo gem install bundler
```
Run bundler in the `oxidized-manager` path:

```shell
sudo -u oxidized -H /bin/bash
cd ~/oxidized-manager
bundle install --without development
```

### Copy and edit the configuration file

```shell
cp config.yml.dist config.yml
vi config.yml
```

Note that the `database` config entry should point to whatever file you
specified in the Oxidized configuration file. Fill in the `ldap` section with
your domain information, and the credentials of an __unprivileged__ user.

### Copy the systemd service file and enable

```shell
sudo cp share/oxidized-manager.service /etc/systemd/system/oxidized-manager.service
sudo systemctl enable oxidized-manager
sudo systemctl start oxidized-manager
```

#### Install and configure NGINX

Install and configure NGINX (outside the scope of this article) to proxy the
puma application server running at the uri `127.0.0.1:9292`, and use a
configuration similar to this:

```
upstream app {
  server 127.0.0.1:9292 fail_timeout=0;
}

server {
  listen 80;
  root /home/oxidized/oxidized-manager/public;
  keepalive_timeout 5;

  try_files $uri @app;

  location @app {
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;
    proxy_pass http://app;
  }
}
```

## Updating

### Stop the application

```shell
sudo systemctl stop oxidized-manager
```

### Backup the device database

Copy your SQLite database somewhere safe in case things go south.
Reference the `config.yml` file if you've forgotten where the database
is located.

### Get the latest code

```shell
sudo -u oxidized -H /bin/bash
cd ~/oxidized-manager
git fetch --all
git checkout master
bundle install --without development
```

### Check for configuration changes

Take a quick peek at `config/config.yml.dist` to make sure no new settings are
available.  If they are, add them to your config.

### Copy the latest systemd file

```shell
sudo cp share/oxidized-manager.service /etc/systemd/system/oxidized-manager.service
sudo systemctl daemon-reload
```

### Start the application

```shell
sudo systemctl start oxidized-manager
```
