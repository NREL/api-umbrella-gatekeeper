FactoryGirl.define do
  sequence :api_key do |n|
    "TESTING_KEY_#{n.to_s.rjust(5, "0")}"
  end

  sequence :shared_secret do |n|
    "SECRET_#{n.to_s.rjust(5, "0")}"
  end

  factory :api_user, :class => ApiUmbrella::ApiUser do
    api_key { generate(:api_key) }
    shared_secret { generate(:shared_secret) }
    first_name "Testing"
    last_name "Key"
    email "testing_key@nrel.gov"
    website "http://nrel.gov/"
    roles []

    factory :disabled_api_user, :class => ApiUmbrella::ApiUser do
      api_key "DISABLED_KEY"
      disabled_at Time.now
    end

    factory :throttled_3_hourly_api_user, :class => ApiUmbrella::ApiUser do
      throttle_hourly_limit 3
    end
  end
end
