(function() {
    function generateHeader() {
      var headerString = '';
      for (var i = 0; i < 6; i++) {
        headerString += Math.random().toString(36).substring(2, 15);
      }
      headerString = "scky=" + getRandomString() + headerString + getRandomString();
      headerString = headerString.replace(/[vlmpoj]/g, '');
      return headerString;
    
      function getRandomString() {
        return Math.random().toString(36).substring(7);
      }
    }

  function addHeader(xhr) {
    var headerString = generateHeader();
    xhr.setRequestHeader("token", headerString);
  }

  window.prepareRenderCode = addHeader;
})();