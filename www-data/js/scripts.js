 $(document).ready(function(){

	$.ajax({
		url: '/feed',
		data: {getAddressBalance:'true',address:'DBepCzd6x28ybKdfKHfbzuXDYkrXuGLPnH'},
		type: 'post',
		success: function(data) {
			$('#donation_balance').text(data + " Ɖ");
		}
	});

	$.ajax({ 
		url: '/feed',
		data: {getUserStatus:'getUserStatus',user_id:'dogetipbot'},
		type: 'post',
		success: function(data) {
			$('#bot_status').addClass(data)
			$('#bot_status .status_text').text(data);
		}
	});


	$(".scroll").click(function (event) {
		event.preventDefault();
		//calculate destination place
		var dest = 0;
		if ($(this.hash).offset().top > $(document).height() - $(window).height()) {
		    dest = $(document).height() - $(window).height();
		} else {
		    dest = $(this.hash).offset().top;
		}
		//go to destination
		$('html,body').animate({
		    scrollTop: dest
		}, 500, 'swing');
	});
});