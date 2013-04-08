require "spec_helper"

describe ApiUmbrella::Gatekeeper::Server do
  describe "authentication" do
    before(:all) do
      @api_user = FactoryGirl.create(:api_user)
      @disabled_api_user = FactoryGirl.create(:disabled_api_user)
    end

    shared_examples "an invalid_request error" do
      it "doesn't call the target app" do
        @backend_called.should eq(false)
      end

      it "returns a 400 HTTP response code" do
        @last_header.status.should eq(400)
      end

      it "returns an 'invalid_request' error code in the body" do
        @last_response.should include('"error":"invalid_request"')
      end
    end

    shared_examples "an invalid_token error" do
      it "doesn't call the target app" do
        @backend_called.should eq(false)
      end

      it "returns a 400 HTTP response code" do
        @last_header.status.should eq(401)
      end

      it "returns an 'invalid_request' error code in the body" do
        @last_response.should include('"error":"invalid_token"')
      end
    end

    context "no bearer token supplied" do
      before(:all) do
        make_request(:get, "/hello")
      end

      it_behaves_like "an invalid_request error"
    end

    context "empty bearer token supplied" do
      before(:all) do
        make_request(:get, "/hello?access_token=")
      end

      it_behaves_like "an invalid_request error"
    end

    context "non-existent bearer token supplied" do
      before(:all) do
        make_request(:get, "/hello?access_token=invalid")
      end

      it_behaves_like "an invalid_token error"
    end

    context "disabled bearer token supplied" do
      before(:all) do
        make_request(:get, "/hello?access_token=#{@disabled_api_user.api_key}")
      end

      it_behaves_like "an invalid_token error"
    end

    context "duplicate bearer tokens supplied" do
      before(:all) do
        make_request(:get, "/hello?access_token=invalid", :head => { :authorization => "Bearer #{@api_user.api_key}" })
      end

      it_behaves_like "an invalid_request error"
    end

    context "valid bearer token supplied" do
      it "calls the target app" do
        make_request(:get, "/hello?access_token=#{@api_user.api_key}")
        @backend_called.should eq(true)
        @last_response.should eq("Hello World")
      end

      it "looks for the bearer token as a GET parameter" do
        make_request(:get, "/hello?access_token=#{@api_user.api_key}")
        @last_response.should eq("Hello World")
      end

      it "looks for the bearer token in the Authorization header" do
        make_request(:get, "/hello", :head => { :authorization => "Bearer #{@api_user.api_key}" })
        @last_response.should eq("Hello World")
      end

      it "accepts HMAC signed requests" do
        nonce = [0, SecureRandom.hex].join(':')
        time = Time.now.utc

        signature = Rack::OAuth2::AccessToken::MAC::Signature.new({
          :secret => @api_user.shared_secret,
          :algorithm => "hmac-sha-256",
          :nonce => nonce,
          :method => "GET",
          :request_uri => "/hello",
          :host => "127.0.0.1",
          :port => "9333",
          :ts => time,
        })

        header = "MAC id=\"#{@api_user.api_key}\""
        header << ", nonce=\"#{nonce}\""
        header << ", ts=\"#{time.to_i}\""
        header << ", mac=\"#{signature.calculate}\""
        header

        make_request(:get, "/hello", :head => { :authorization => header })
        @last_response.should eq("Hello World")
      end

    end

    context "legacy api keys" do
      context "legacy api_key mode disabled (default)" do
        it "does not look for the bearer token in the api_key GET parameter" do
          make_request(:get, "/hello?api_key=#{@api_user.api_key}")
          @last_header.status.should eq(400)
        end

        it "does not look for the bearer token in basic HTTP authentication" do
          make_request(:get, "/hello", :head => { :authorization => [@api_user.api_key, ""] })
          @last_header.status.should eq(400)
        end
      end

      context "legacy api_key mode enabled" do
        before(:all) do
          @gatekeeper_config = "gatekeeper_legacy.yml"
        end

        after(:all) do
          @gatekeeper_config = nil
        end

        it "looks for the api key as a GET parameter" do
          make_request(:get, "/hello?api_key=#{@api_user.api_key}")
          @last_response.should eq("Hello World")
        end

        it "looks for the api_key inside basic HTTP authentication" do
          make_request(:get, "/hello", :head => { :authorization => [@api_user.api_key, ""] })
          @last_response.should eq("Hello World")
        end

        it "prefers the api_key in the GET parameter over basic HTTP authentication" do
          make_request(:get, "/hello?api_key=#{@api_user.api_key}", :head => { :authorization => ["invalid", ""] })
          @last_response.should eq("Hello World")
        end

        context "empty api_key supplied" do
          it "doesn't call the target app" do
            make_request(:get, "/hello?api_key=")
            @backend_called.should eq(false)
          end

          it "returns a forbidden message" do
            make_request(:get, "/hello?api_key=")

            @last_header.status.should eq(403)
            @last_response.should include("No api_key was supplied.")
          end
        end

        context "invalid api_key supplied" do
          it "doesn't call the target app" do
            make_request(:get, "/hello?api_key=invalid")
            @backend_called.should eq(false)
          end

          it "returns a forbidden message" do
            make_request(:get, "/hello?api_key=invalid")

            @last_header.status.should eq(403)
            @last_response.should include("An invalid api_key was supplied.")
          end
        end

        context "disabled api_key supplied" do
          it "doesn't call the target app" do
            make_request(:get, "/hello?api_key=#{@disabled_api_user.api_key}")
            @backend_called.should eq(false)
          end

          it "returns a forbidden message" do
            make_request(:get, "/hello?api_key=#{@disabled_api_user.api_key}")

            @last_header.status.should eq(403)
            @last_response.should include("The api_key supplied has been disabled.")
          end
        end
      end
    end
  end
end
