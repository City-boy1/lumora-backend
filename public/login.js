const form = document.getElementById('loginForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (e) => {

    e.preventDefault();

    const name = document.getElementById('name').value;
    const password = document.getElementById('password').value;

    try {

        const response = await fetch(
            'http://localhost:3000/auth',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                credentials: 'include',

                body: JSON.stringify({
                    name,
                    password
                })
            }
        );

        if(!response.ok){
            message.textContent = 'Invalid Login';
            return;
        }

        window.location = 'dashboard.html';

    } catch(err){

        message.textContent = 'Server Error';
        console.error(err);

    }
});