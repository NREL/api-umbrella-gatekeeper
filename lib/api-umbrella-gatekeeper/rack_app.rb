module ApiUmbrella
  module Gatekeeper
    class RackApp
      def self.instance
        @@instance ||= ::Rack::Builder.app do
          use ApiUmbrella::Gatekeeper::Rack::FormattedErrorResponse
          use ::Rack::OAuth2::Server::Resource::Bearer, "Something" do |req|
            ApiUser.active.where(:api_key => req.access_token).first || req.invalid_token!
          end
          use ::Rack::OAuth2::Server::Resource::MAC, 'Rack::OAuth2 Sample Protected Resources' do |req|
            user = ApiUser.active.where(:api_key => req.access_token).first || req.invalid_token!
            user.to_mac_token.verify!(req)
            user
          end
          use ApiUmbrella::Gatekeeper::Rack::Authenticate
          use ApiUmbrella::Gatekeeper::Rack::Authorize
          use ApiUmbrella::Gatekeeper::Rack::Throttle::Daily,
            :cache => ApiUmbrella::Gatekeeper.redis,
            :max => ApiUmbrella::Gatekeeper.config["throttle"]["daily_max"],
            :code => ApiUmbrella::Gatekeeper.config["throttle"]["http_code"]
          use ApiUmbrella::Gatekeeper::Rack::Throttle::Hourly,
            :cache => ApiUmbrella::Gatekeeper.redis,
            :max => ApiUmbrella::Gatekeeper.config["throttle"]["hourly_max"],
            :code => ApiUmbrella::Gatekeeper.config["throttle"]["http_code"]

          # Return a 200 OK status if all the middlewares pass through
          # successfully. This indicates to the calling ApiUmbrella::Gatekeeper::RequestHandler
          # that no errors have occurred processing the headers, and the
          # application can continue with a instruction to proxymachine.
          run lambda { |env| [200, {}, ["OK"]] }
        end
      end
    end
  end
end
