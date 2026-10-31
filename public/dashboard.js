const employeesList = document.getElementById('employees');
const message = document.getElementById('message');

let accessToken = '';

const getAccessToken = async () => {

    try {

        const response = await fetch('/refresh', {
            method:'GET',
            credentials:'include'
        });

        if(!response.ok){
            return null;
        }

        const data = await response.json();

        return data.accessToken;

    } catch(err){

        console.error(err);

        return null;
    }
};

const loadEmployees = async () => {

    accessToken = await getAccessToken();

    if(!accessToken){

        window.location = '/';

        return;
    }

    try {

        const response = await fetch('/employees', {

            headers:{
                Authorization:`Bearer ${accessToken}`
            },

            credentials:'include'
        });

        if(response.status === 401 ||
           response.status === 403){

            window.location = '/';

            return;
        }

        const employees = await response.json();

        employeesList.innerHTML = '';

        employees.forEach(emp => {

            const li = document.createElement('li');

            li.textContent =
                `${emp.firstname} ${emp.lastname}`;

            employeesList.appendChild(li);
        });

    } catch(err){

        console.error(err);

        message.textContent = 'Error loading employees';
    }
};

document.getElementById('logoutBtn')
.addEventListener('click', async ()=>{

    await fetch('/logout', {
        method:'POST',
        credentials:'include'
    });

    window.location = '/';
});

loadEmployees();