require "mongoid"

module ApiUmbrella
  class ApiUser
    include Mongoid::Document
    include Mongoid::Timestamps

    store_in :collection => "api_users"

    field :api_key
    field :shared_secret
    field :first_name
    field :last_name
    field :email
    field :website
    field :use_description
    field :unthrottled, :type => Boolean
    field :throttle_hourly_limit, :type => Integer
    field :throttle_daily_limit, :type => Integer
    field :throttle_by_ip, :type => Boolean
    field :disabled_at, :type => Time

    field :roles, :type => Array

    index({ :api_key => 1 }, { :unique => true })

    # Validations
    #
    # Provide full sentence validation errors. This doesn't really vibe with how
    # Rails intends to do things by default, but the we're super picky about
    # wording of things on the AFDC site which uses these messages. MongoMapper
    # and ActiveResource combined don't give great flexibility for error message
    # handling, so we're stuck with full sentences and changing how the errors
    # are displayed.
    validates_uniqueness_of :api_key
    validates_presence_of :first_name,
      :message => "Provide your first name."
    validates_presence_of :last_name,
      :message => "Provide your last name."
    validates_presence_of :email,
      :message => "Provide your email address."
    validates_format_of :email,
      :with => /.+@.+\..+/,
      :allow_blank => true,
      :message => "Provide a valid email address."
    validates_presence_of :website,
      :message => "Provide your website URL.",
      :unless => lambda { |user| user.no_domain_signup }
    validates_format_of :website,
      :with => /\w+\.\w+/,
      :unless => lambda { |user| user.no_domain_signup },
      :message => "Your website must be a valid URL in the form of http://nrel.gov"
    validates_acceptance_of :terms_and_conditions,
      :message => "Check the box to agree to the terms and conditions."

    # Callbacks
    before_validation :generate_api_key, :on => :create

    attr_accessor :terms_and_conditions, :no_domain_signup

    # Protect against mass-assignment.
    attr_accessible :first_name, :last_name, :email, :website, :use_description,
      :terms_and_conditions

    def self.active
      where(:disabled_at => nil)
    end

    # has_role? simply needs to return true or false whether a user has a role or not.  
    # It may be a good idea to have "admin" roles return true always
    def has_role?(role_in_question)
      has_role = false

      if self.roles
        if self.roles.include?("admin")
          has_role = true
        else
          has_role = self.roles.include?(role_in_question.to_s)
        end
      end

      has_role
    end

    def self.human_attribute_name(attribute, options = {})
      case(attribute.to_sym)
      when :email
        "Email"
      when :terms_and_conditions
        "Terms and conditions"
      when :website
        "Web site"
      else
        super
      end
    end

    def as_json(*args)
      hash = super(*args)

      if(!self.valid?)
        hash.merge!(:errors => self.errors.full_messages)
      end

      hash
    end

    def to_mac_token
      mac_token = Rack::OAuth2::AccessToken::MAC.new({
        :access_token  => self.api_key,
        :mac_key       => self.shared_secret,
        :mac_algorithm => "hmac-sha-256",
        :expires_in    => 1.minute,
      })
    end

    private

    def generate_api_key
      unless self.api_key
        self.api_key = SecureRandom.hex(20) # This actually generates a random key 40, not 20, characters long.
      end
    end
  end
end
