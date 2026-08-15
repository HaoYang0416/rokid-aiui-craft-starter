export default {
  onLaunch() {
    console.log('Echo app launched');
  },

  onShow() {
    console.log('Echo app shown');
  },

  onHide() {
    console.log('Echo app hidden');
  },

  globalData: {
    productName: '回声 Echo',
    rewindSeconds: 60,
  },
};
