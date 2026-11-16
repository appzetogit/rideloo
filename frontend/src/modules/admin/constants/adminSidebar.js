import {
  Briefcase,
  // Bus,
  Car,
  Clock,
  FileText,
  Gavel,
  Globe,
  Home,
  IndianRupee,
  Receipt,
  Layers,
  MapPin,
  MessageCircle,
  Monitor,
  Package,
  Settings,
  Settings2,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * The admin sidebar: every menu, sub-menu and the permission each needs.
 *
 * Kept out of AdminLayout so the admin-account permission picker can build
 * its list from exactly this. The picker used to have its own hand-written
 * list of 30 coarse modules, so most of the 130-odd menus could not be
 * granted or withheld one by one, and any menu added here never appeared
 * there.
 */
export const ADMIN_SIDEBAR_SECTIONS = [
  {
    title: 'Home',
    items: [
      {
        icon: UserCog,
        label: 'Admin Management',
        subItems: [
          { label: 'Admins', path: '/admin/management/admins', permission: 'subadmins.manage' },
        ],
      },
      { icon: Home, label: 'Dashboard', path: '/admin/dashboard', permission: 'dashboard.view' },
      { icon: IndianRupee, label: 'Admin Earnings', path: '/admin/earnings', permission: 'earnings.view' },
      { icon: Receipt, label: 'Payments', path: '/admin/payments', permission: 'earnings.view' },
      { icon: MessageCircle, label: 'Chat', path: '/admin/chat', permission: 'chat.view' },
      {
        icon: TrendingUp,
        label: 'Promotions Management',
        subItems: [
          { label: 'Promo Code', path: '/admin/promotions/promo-codes', permission: 'promotions.view' },
          { label: 'Push Notifications', path: '/admin/promotions/send-notification', permission: 'promotions.view' },
          { label: 'Banner Image', path: '/admin/promotions/banner-image', permission: 'promotions.view' },
        ],
      },
      {
        icon: IndianRupee,
        label: 'Price Management',
        subItems: [
          { label: 'Service Location', path: '/admin/pricing/service-location', permission: 'service_locations.view' },
          { label: 'Zone', path: '/admin/pricing/zone', permission: 'zones.view' },
          { label: 'Airport', path: '/admin/pricing/airport', permission: 'airports.view' },
          { label: 'Set Price', path: '/admin/pricing/set-price', permission: 'set_prices.view' },
          //{ label: 'Goods Types', path: '/admin/pricing/goods-types', permission: 'goods_types.view' },
        ],
      },
      { icon: Gavel, label: 'Bidding', path: '/admin/settings/business/bid-ride', permission: 'settings.view' },
      {
        icon: IndianRupee,
        label: 'Driver Subscription',
        subItems: [
          { label: 'Analytics', path: '/admin/driver-subscription/analytics', permission: 'earnings.view' },
          { label: 'Plans & Settings', path: '/admin/settings/business/driver-subscription', permission: 'settings.view' },
        ],
      },
      {
        icon: TrendingUp,
        label: 'Price Hike',
        subItems: [
          { label: 'Hike Slots', path: '/admin/pricing/price-hike', permission: 'set_prices.view' },
        ],
      },
      {
        icon: Briefcase,
        label: 'Rental',
        subItems: [
          { label: 'Service Stores', path: '/admin/pricing/service-stores', permission: 'service_stores.view' },
          { label: 'Pending Service Stores', path: '/admin/pricing/service-stores/pending', permission: 'service_stores.view' },
          { label: 'Pending Service Staff', path: '/admin/pricing/service-stores/pending-staff', permission: 'service_stores.view' },
          { label: 'Rental Commission', path: '/admin/pricing/rental-commission', permission: 'rental.view' },
          { label: 'Rental Vehicles', path: '/admin/pricing/rental-vehicles', permission: 'rental.view' },
          { label: 'Track Vehicles', path: '/admin/pricing/rental-tracking', permission: 'rental.view' },
          { label: 'Rental Requests', path: '/admin/pricing/rental-requests', permission: 'rental.view' },
          { label: 'Rental Quote Requests', path: '/admin/pricing/rental-quotes', permission: 'rental.view' },
          { label: 'Rental Package Types', path: '/admin/pricing/rental-packages', permission: 'rental.view' },
          { label: 'Package Pricing', path: '/admin/pricing/package-pricing', permission: 'rental.view' },
        ],
      },
      /*
      {
        icon: Bus,
        label: 'Bus Service',
        subItems: [
          { label: 'Fleet Manager', path: '/admin/bus-service', permission: 'bus_service.view' },
          { label: 'Pending Bus Drivers', path: '/admin/bus-service/pending-drivers', permission: 'bus_service.view' },
          { label: 'Bus Commission', path: '/admin/bus-service/commission', permission: 'bus_service.view' },
          { label: 'Bus Bookings', path: '/admin/bus-service/bookings', permission: 'bus_service.view' },
        ],
      },
      {
        icon: Share2,
        label: 'Car Pooling',
        subItems: [
          { label: 'Pending Pooling Drivers', path: '/admin/pooling/pending-drivers', permission: 'pooling.view' },
          { label: 'Pooling Vehicles', path: '/admin/pooling/vehicles', permission: 'pooling.view' },
          { label: 'Pooling Commission', path: '/admin/pooling/commission', permission: 'pooling.view' },
          { label: 'Routes & Stops', path: '/admin/pooling/routes', permission: 'pooling.view' },
          { label: 'Pooling Bookings', path: '/admin/pooling/bookings', permission: 'pooling.view' },
        ],
      },
      */
      {
        icon: MapPin,
        label: 'Geofencing',
        subItems: [
          { label: 'Heat Map', path: '/admin/geo/heatmap', permission: 'geofencing.view' },
          { label: "God's Eye", path: '/admin/geo/gods-eye', permission: 'geofencing.view' },
        ],
      },
      { icon: ShieldAlert, label: 'SOS', path: '/admin/safety', permission: 'dashboard.view' },
      { icon: Car, label: 'Trip Requests', path: '/admin/trips', permission: 'trips.view' },
      { icon: Package, label: 'Delivery Requests', path: '/admin/deliveries', permission: 'deliveries.view' },
      { icon: Clock, label: 'Ongoing Requests', path: '/admin/ongoing', permission: 'ongoing.view' },
    ],
  },
  {
    title: 'Users',
    items: [
      {
        icon: Users,
        label: 'Customer Management',
        subItems: [
          { label: 'User List', path: '/admin/users', permission: 'users.view' },
          { label: 'Subscription Management', path: '/admin/users/subscriptions', permission: 'users.view' },
          { label: 'Delete Request Users', path: '/admin/users/delete-requests', permission: 'users.view' },
          { label: 'User Bulk Upload', path: '/admin/users/bulk-upload', permission: 'users.view' },
        ],
      },
      { icon: Wallet, label: 'Wallet Payment', path: '/admin/wallet/payment', permission: 'wallet.view' },
      {
        icon: Car,
        label: 'Driver Management',
        subItems: [
          { label: 'Pending Drivers', path: '/admin/drivers/pending', permission: 'drivers.view' },
          { label: 'Approved Drivers', path: '/admin/drivers', permission: 'drivers.view' },
          { label: 'Active Drivers', path: '/admin/drivers/active', permission: 'drivers.view' },
          //cd front{ label: 'Subscription', path: '/admin/drivers/subscription', permission: 'drivers.view' },
          { label: 'Drivers Ratings', path: '/admin/drivers/ratings', permission: 'drivers.view' },
          {
            label: 'Driver Wallet',
            subItems: [
              { label: 'Withdrawal Requests', path: '/admin/drivers/wallet/withdrawals', permission: 'wallet.view' },
              { label: 'Negative Balance Drivers', path: '/admin/drivers/wallet/negative', permission: 'wallet.view' },
            ],
          },
          { label: 'Delete Request Drivers', path: '/admin/drivers/delete-requests', permission: 'drivers.view' },
          { label: 'Driver Needed Documents', path: '/admin/drivers/documents', permission: 'drivers.view' },
          //  { label: 'Driver Bulk Upload', path: '/admin/drivers/bulk-upload', permission: 'drivers.view' },
          { label: 'Payment Methods', path: '/admin/drivers/payment-methods', permission: 'wallet.view' },
          { label: 'Driver Wallet Managment', path: '/admin/settings/app/wallet', permission: 'settings.view' },
        ],
      },
      {
        icon: Share2,
        label: 'Referral Management',
        subItems: [
          { label: 'Referral Dashboard', path: '/admin/referrals/dashboard', permission: 'referrals.view' },
          { label: 'User Referral Settings', path: '/admin/referrals/user-settings', permission: 'referrals.view' },
          { label: 'Driver Referral Settings', path: '/admin/referrals/driver-settings', permission: 'referrals.view' },
          { label: 'Referral Translation', path: '/admin/referrals/translation', permission: 'referrals.view' },
        ],
      },
      {
        icon: UserCog,
        label: 'Employee Management',
        subItems: [
          { label: 'Employee List', path: '/admin/employees', permission: 'employees.view' },
          { label: 'Add Employee', path: '/admin/employees/create', permission: 'employees.view' },
        ],
      },
      // { icon: Briefcase, label: 'Owner Management', path: '/admin/owners/dashboard', permission: 'owners.view' },
      {
        icon: FileText,
        label: 'Report',
        subItems: [
          { label: 'User Report', path: '/admin/reports/user', permission: 'reports.view' },
          { label: 'Driver Report', path: '/admin/reports/driver', permission: 'reports.view' },
          { label: 'Driver Duty Report', path: '/admin/reports/driver-duty', permission: 'reports.view' },
          { label: 'Owner Report', path: '/admin/reports/owner', permission: 'reports.view' },
          { label: 'Finance Report', path: '/admin/reports/finance', permission: 'reports.view' },
          { label: 'Fleet Finance Report', path: '/admin/reports/fleet-finance', permission: 'reports.view' },
        ],
      },
      {
        icon: ShieldCheck,
        label: 'Support Management',
        subItems: [
          { label: 'Ticket Title', path: '/admin/support/ticket-title', permission: 'support.view' },
          { label: 'Support Tickets', path: '/admin/support/tickets', permission: 'support.view' },
        ],
      },
      {
        icon: Briefcase,
        label: 'Careers Management',
        subItems: [
          { label: 'Job Positions', path: '/admin/careers/jobs', permission: 'support.view' },
          { label: 'Applications', path: '/admin/careers/applications', permission: 'support.view' },
        ],
      },
    ],
  },
  {
    title: 'Masters',
    items: [
      { icon: Globe, label: 'Language', path: '/admin/masters/languages', permission: 'settings.view' },
      // { icon: Star, label: 'Preferences', path: '/admin/masters/preferences' },
      // { icon: ShieldCheck, label: 'Roles', path: '/admin/masters/roles' },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        icon: Settings,
        label: 'Business Settings',
        permission: 'settings.view',
        subItems: [
          { label: 'General Settings', path: '/admin/settings/business/general', permission: 'settings.view' },
          { label: 'Customization Settings', path: '/admin/settings/business/customization', permission: 'settings.view' },
          { label: 'Transport Ride Settings', path: '/admin/settings/business/transport-ride', permission: 'settings.view' },
          { label: 'Cancellation Reasons', path: '/admin/settings/cancellation-reasons', permission: 'settings.view' },
        ],
      },
      {
        icon: Smartphone,
        label: 'App Settings',
        permission: 'settings.view',
        subItems: [
          { label: 'Wallet Settings', path: '/admin/settings/app/wallet', permission: 'settings.view' },
          { label: 'Tip Settings', path: '/admin/settings/app/tip', permission: 'settings.view' },
          { label: 'Ride Voice Announcements', path: '/admin/settings/app/ride-voice', permission: 'settings.view' },
          // { label: 'Mobile App Landing/Onboard Screens Settings', path: '/admin/settings/app/onboard', permission: 'settings.view' },
        ],
      },
      {
        icon: Layers,
        label: 'User App Management',
        permission: 'settings.view',
        subItems: [
          { label: 'App Modules', path: '/admin/pricing/app-modules', permission: 'settings.view' },
          { label: 'Vehicle Type', path: '/admin/pricing/vehicle-type', permission: 'vehicle_types.view' },
          { label: 'Home Sections', path: '/admin/settings/user-app/home-sections', permission: 'settings.view' },
          { label: 'Everything In Minutes', path: '/admin/settings/user-app/everything-in-minutes', permission: 'settings.view' },
          { label: 'Explore Cards', path: '/admin/settings/user-app/explore-cards', permission: 'settings.view' },
          { label: 'Promo Banners', path: '/admin/settings/user-app/promo-banners', permission: 'settings.view' },
          { label: 'Go Places', path: '/admin/settings/user-app/go-places', permission: 'settings.view' },
          { label: 'Footer Content', path: '/admin/settings/user-app/footer-content', permission: 'settings.view' },
        ],
      },
      {
        icon: Settings2,
        label: 'Third-party Settings',
        permission: 'settings.view',
        subItems: [
          { label: 'Payment Gateway Settings', path: '/admin/settings/third-party/payment', permission: 'settings.view' },
          { label: 'Recharge API Setup', path: '/admin/settings/third-party/recharge-api', permission: 'settings.view' },
          // { label: 'SMS Gateway Settings', path: '/admin/settings/third-party/sms', permission: 'settings.view' },
          // { label: 'Firebase Settings', path: '/admin/settings/third-party/firebase', permission: 'settings.view' },
          // { label: 'Map and Map APIs Settings', path: '/admin/settings/third-party/map-apis', permission: 'settings.view' },
          { label: 'SMTP Configuration', path: '/admin/settings/third-party/mail', permission: 'settings.view' },
          // { label: 'Notification Channel', path: '/admin/settings/third-party/notification-channel' },
        ],
      },
      // {
      //   icon: PlusCircle,
      //   label: 'Addons',
      //   subItems: [{ label: 'Dispatcher Addons', path: '/admin/settings/addons/dispatcher' }],
      // },
      // Only the sections that are actually editable are listed. The rest of
      // the marketing site is still hardcoded in modules/landing; add entries
      // here as those sections move into the CMS.
      {
        icon: Monitor,
        label: 'Website Content',
        permission: 'landing_content.view',
        subItems: [
          { label: 'Landing Page', path: '/admin/settings/cms/landing', permission: 'landing_content.view' },
          { label: 'Enquiries', path: '/admin/settings/cms/enquiries', permission: 'enquiries.view' },
        ],
      },
    ],
  },
];
