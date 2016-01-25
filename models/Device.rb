# Represents a Device in the database.  This table will be queried by Oxidized when it starts up.
class Device
  include DataMapper::Resource

  ADDRESS_FORMAT = /^[\w\-\.]+$/

  property :id, Serial
  property :name, String
  property :type, String
  property :address, String
  property :username, String
  property :password, String
  property :enable, String
  property :created_at, DateTime
  property :updated_at, DateTime

  validates_presence_of :name
  validates_uniqueness_of :name

  validates_presence_of :type
  validates_length_of :type, :min => 3

  validates_presence_of :address
  validates_uniqueness_of :address
  validates_format_of :address, :with => ADDRESS_FORMAT

  validates_presence_of :username
  validates_presence_of :password
end
