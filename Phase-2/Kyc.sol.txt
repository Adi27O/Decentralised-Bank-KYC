// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;


interface BankInterface {
    function addNewCustomerRequest(string memory _custName, string memory _custData) external;
    function addCustomer(string memory _custName,string memory _custData) external ;
    function removeCustomer(string memory _custName) external;
    function modifyCustomer(string memory custName,string memory custData) external;
    function upVoteCustomer(string memory custName) external;
    function downVoteCustomer(string memory custName) external;
    function reportSuspectedBank(address suspiciousBankAddress) external;
    function viewCustomerData(string memory custName) external view returns(string memory,bool);
    function getCustomerKycStatus(string memory custName) external view returns(bool);
}

interface Admin {
    function addBank(string memory _bankName,string memory _regNumber,address _ethAddress) external;
    function editBankVoteStatus(address _ethAddress, bool _permission) external;
    function removeBank(address _ethAddress) external;
}

contract Kyc is BankInterface, Admin{

    address admin;

    struct Customer {
        string userName;
        string data;
        uint256 upVotes;
        uint256 downVotes;
        address bank;
        bool kycStatus; 
    }

    struct Bank {
        string name;
        address ethAddress;
        uint256 complaintsReported;
        uint256 kycCount;
        bool isAllowedToVote;
        string regNumber;
        uint256 suspiciousVotes;
        bool kycPrivilege;
    }

    struct KYCRequest {
        string userName;
        string customerData;
        address bankAddress;
    }
    
    event ContractInitialized();
    event CustomerRequestAdded(string indexed _custName);
    event CustomerRequestRemoved(string indexed _custName);
    event CustomerRequestApproved();

    event NewCustomerCreated(string _custName, address _ethAddress);
    event CustomerRemoved(string _custName);
    event CustomerInfoModified(string _custName);

    event NewBankCreated(address _ethAddress);
    event BankRemoved(address _ethAddress);
    event BankBlockedFromKYC(address _ethAddress, bool _permission);

    constructor() {
        emit ContractInitialized();
        admin = msg.sender;
    }

    uint public totalBanks = 0;
    uint public bannedBanks = 0;

    uint public constant threshold = 5;

    mapping(string => Customer) customersInfo;  //  Mapping a customer's username to the Customer
    mapping(address => Bank) banks; //  Mapping a bank's address to the Bank
    mapping(string => address) bankVsRegNoMapping; //  Mapping a bank's registration number to the Bank
    mapping(string => KYCRequest) kycRequests; //  Mapping a customer's username to KYC request
    mapping(string => mapping(address => uint256)) upvotes; //To track upVotes of all customers vs banks
    mapping(string => mapping(address => uint256)) downvotes; //To track downVotes of all customers vs banks
    mapping(address => mapping(int => uint256)) bankActionsAudit; //To track downVotes of all customers vs banks
    
    
    modifier isAdmin() {
        require(msg.sender == admin, "Only admin is allowed");
        _;
    }

    modifier isValidBank() {
        require (msg.sender == banks[msg.sender].ethAddress, "Only banks are allowed to transact");
        _;
    }


    // ADMIN FUNCTIONS

    /********************************************************************************************************************
     *
     *  Name        :   addBank
     *  Description :   This function is used by the admin to add a bank to the KYC Contract. You need to verify if the
     *                  user trying to call this function is admin or not, so we use isAdmin modifier for it. 
     *  Parameters  :
     *      param  {string} bankName :  The name of the bank/organisation.
     *      param  {string} regNumber :   registration number for the bank. This is unique.
     *      param  {address} ethAddress :  The  unique Ethereum address of the bank/organisation
     *
     *******************************************************************************************************************/
    function addBank(string memory _bankName,string memory _regNumber,address _ethAddress) external override isAdmin {
        require(banks[_ethAddress].ethAddress == address(0), "A Bank already exists with same Address"); // Check if bank with same ethAddress is not already added
        require(bankVsRegNoMapping[_regNumber] == address(0),"A Bank already exists with same registration number"); // Check if bank with same registration number is not already added
        banks[_ethAddress] = Bank(_bankName,_ethAddress,0,0,true,_regNumber,0,true); //creates a new bank
        bankVsRegNoMapping[_regNumber] = _ethAddress;
        totalBanks++; // increment bank count
        emit NewBankCreated(_ethAddress); // emit event to store info in logs
        
    }

    /********************************************************************************************************************
     *
     *  Name        :   removeBank
     *  Description :   This function is used by the admin to remove a bank from the KYC Contract.
     *                  You need to verify if the user trying to call this function is admin or not.
     *  Parameters  :
     *      @param  {address} ethAddress :  The  unique Ethereum address of the bank/organisation
     *
     *******************************************************************************************************************/
    function removeBank(address _ethAddress) external override isAdmin {
        require(banks[_ethAddress].ethAddress != address(0), "Bank not found"); // check if bank exists before deleting
        delete bankVsRegNoMapping[banks[_ethAddress].regNumber];
        delete banks[_ethAddress]; // delete the bank
        totalBanks--; //decrement bank count
        emit BankRemoved(_ethAddress);  // emit event to store info in logs
        
    }

    /********************************************************************************************************************
     *
     *  Name        :   blockBankFromKYC
     *  Description :   This function can only be used by the admin to change the status of kycPermission of any of the
     *                  banks at any point of the time.
     *  Parameters  :
     *      @param  {address} _ethAddress :  The  unique Ethereum address of the bank/organisation
     *      @param  {bool} _permission :  True / False to change voting permission
     *
     *******************************************************************************************************************/
    function editBankVoteStatus(address _ethAddress, bool _permission) external override isAdmin {
        require(banks[_ethAddress].ethAddress != address(0), "Bank not found");
        
        if(!_permission && banks[_ethAddress].isAllowedToVote)
        {
            bannedBanks++;
        }
        if(_permission && !banks[_ethAddress].isAllowedToVote)
        {
            bannedBanks--;
        }
        banks[_ethAddress].isAllowedToVote = _permission;
        emit BankBlockedFromKYC(_ethAddress,_permission);
        
    }

    /********************************************************************************************************************
     *
     *  Name        :   addNewCustomerRequest
     *  Description :   This function is used to add the KYC request to the requests list. If kycPermission is set to false bank won’t be allowed to add requests for any customer.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer for whom KYC is to be done
     *      @param  {string} custData :  The hash of the customer data as a string.
     *
     *******************************************************************************************************************/
    function addNewCustomerRequest(string memory _custName, string memory _custData) external override isValidBank {
        require(banks[msg.sender].isAllowedToVote, "Requested Bank doesn't have KYC Privilege");
        require(customersInfo[_custName].bank != address(0), "Requested Customer does not exist");
        require(kycRequests[_custName].bankAddress == address(0), "A KYC Request is already pending with this Customer");

        kycRequests[_custName] = KYCRequest(_custName, _custData ,msg.sender);
        banks[msg.sender].kycCount++;

        emit CustomerRequestAdded(_custName);
    }

   


    /********************************************************************************************************************
     *
     *  Name        :   removeCustomerRequest
     *  Description :   This function will remove the request from the requests list.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer for whom KYC request has to be deleted
     *
     *******************************************************************************************************************/

    function removeCustomerRequest(string memory _custName) public isValidBank {
        require(kycRequests[_custName].bankAddress ==msg.sender, "Requested Bank is not authorized to remove this customer as KYC is not initiated by you");
        delete kycRequests[_custName];
        emit CustomerRequestRemoved(_custName);
    }

    /********************************************************************************************************************
     *
     *  Name        :   addCustomer
     *  Description :   This function will add a customer to the customer list. If IsAllowed is false then don't process
     *                  the request.
     *  Parameters  :
     *      param {string} custName :  The name of the customer
     *      param {string} custData :  The hash of the customer data as a string.
     *
     *******************************************************************************************************************/
    function addCustomer(string memory _custName,string memory _custData) external override isValidBank {
        require(customersInfo[_custName].bank == address(0), "Requested Customer already exists");
        customersInfo[_custName] = Customer(_custName, _custData, 0,0,msg.sender,false);
        emit NewCustomerCreated(_custName,msg.sender);
    }

    /********************************************************************************************************************
     *
     *  Name        :   removeCustomer
     *  Description :   This function will remove the customer from the customer list. Remove the kyc requests of that customer
     *                  too. Only the bank which added the customer can remove him.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *
     *******************************************************************************************************************/

    function removeCustomer(string memory _custName) external override  {
        require(customersInfo[_custName].bank != address(0), "Requested Customer not found");
        require(customersInfo[_custName].bank ==msg.sender, "Requested Bank is not authorized to remove this customer as KYC is not initiated by you");

        delete customersInfo[_custName];
        removeCustomerRequest(_custName);
        emit CustomerRemoved(_custName);
        
    }

    /********************************************************************************************************************
     *
     *  Name        :   modifyCustomer
     *  Description :   This function allows a bank to modify a customer's data. This will remove the customer from the kyc
     *                  request list and set the number of downvote and upvote to zero.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *      @param  {string} custData :  The hash of the customer data as a string.
     *
     *******************************************************************************************************************/

    function modifyCustomer(string memory custName,string memory custData) external override  {
        require(customersInfo[custName].bank != address(0), "Requested Customer not found");
        removeCustomerRequest(custName);

        customersInfo[custName].data = custData;
        customersInfo[custName].upVotes = 0;
        customersInfo[custName].downVotes = 0;

        emit CustomerInfoModified(custName);

        
    }

   

    /********************************************************************************************************************
     *
     *  Name        :   upVoteCustomer
     *  Description :   This function allows a bank to cast an upvote for a customer. This vote from a bank means that
     *                  it accepts the customer details as well acknowledge the KYC process done by some bank on the customer.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *
     *******************************************************************************************************************/

    function upVoteCustomer(string memory custName) external override  {
        require(banks[msg.sender].isAllowedToVote, "Requested Bank does not have Voting Privilege");
        require(customersInfo[custName].bank != address(0), "Requested Customer not found");
        if(downvotes[custName][msg.sender]!=0)
        {
            downvotes[custName][msg.sender] = 0;
            customersInfo[custName].downVotes--;

        }
        if(upvotes[custName][msg.sender]==0)
        {
            customersInfo[custName].upVotes++;
            bool isKYCApproved = (customersInfo[custName].upVotes >= customersInfo[custName].downVotes);
            customersInfo[custName].kycStatus = (totalBanks - bannedBanks > threshold) ? ( customersInfo[custName].downVotes <  totalBanks/3 && isKYCApproved) : isKYCApproved;
            upvotes[custName][msg.sender] = block.timestamp;
        }    
    }

    /********************************************************************************************************************
     *
     *  Name        :   downVoteCustomer
     *  Description :   This function allows a bank to cast an downvote for a customer. This vote from a bank means that
     *                  it does not accept the customer details.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *
     *******************************************************************************************************************/
    function downVoteCustomer(string memory custName) external override  {
        require(banks[msg.sender].isAllowedToVote, "Requested Bank does not have Voting Privilege");
        require(customersInfo[custName].bank != address(0), "Requested Customer not found");

         if(upvotes[custName][msg.sender]!=0)
        {
            upvotes[custName][msg.sender] = 0;
            customersInfo[custName].upVotes--;

        }
        if(downvotes[custName][msg.sender]==0)
        {
        customersInfo[custName].downVotes++;
        bool isKYCApproved = (customersInfo[custName].upVotes >= customersInfo[custName].downVotes);
        customersInfo[custName].kycStatus = (totalBanks - bannedBanks > threshold) ? ( customersInfo[custName].downVotes <  totalBanks/3 && isKYCApproved) : isKYCApproved;
        downvotes[custName][msg.sender] = block.timestamp;
        }
        
    }

    /********************************************************************************************************************
     *
     *  Name        :   reportSuspectedBank
     *  Description :   This function allows a bank to report doubt/suspicion about another bank
     *  Parameters  :
     *      @param  {string} custName :  The address of the bank which is suspicious
     *
     *******************************************************************************************************************/
    function reportSuspectedBank(address suspiciousBankAddress) external override  {
        require(banks[suspiciousBankAddress].ethAddress != address(0), "Requested Bank not found");
        banks[suspiciousBankAddress].suspiciousVotes++;
        if(banks[suspiciousBankAddress].suspiciousVotes >= totalBanks/3)
        {
            banks[suspiciousBankAddress].isAllowedToVote = false;
        }
        
    }


     /********************************************************************************************************************
     *
     *  Name        :   viewCustomerData
     *  Description :   This function allows a bank to view details of a customer.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *
     *******************************************************************************************************************/

    function viewCustomerData(string memory custName) external override view returns(string memory,bool){
        require(customersInfo[custName].bank != address(0), "Requested Customer not found");
        return (customersInfo[custName].data,customersInfo[custName].kycStatus);
    }

    /********************************************************************************************************************
     *
     *  Name        :   getCustomerKycStatus
     *  Description :   This function is used to fetch customer kyc status from the smart contract. If true then the customer
     *                  is verified.
     *  Parameters  :
     *      @param  {string} custName :  The name of the customer
     *
     *******************************************************************************************************************/

    function getCustomerKycStatus(string memory custName) external override view returns(bool){
        require(customersInfo[custName].bank != address(0), "Requested Customer not found");
        return (customersInfo[custName].kycStatus);
    }



    // /*********************************************************
    // *            Internal functions
    // *********************************************************/


    /********************************************************************************************************************
     *
     *  Name        :   areBothStringSame
     *  Description :   This is an internal function is verify equality of strings
     *  Parameters  :
     *      @param {string} a :   1st string
     *      @param  {string} b :   2nd string
     *
     *******************************************************************************************************************/
    function areBothStringSame(string memory a, string memory b) private pure returns (bool) {
        if(bytes(a).length != bytes(b).length) {
            return false;
        } else {
            return keccak256(bytes(a)) == keccak256(bytes(b));
        }
    }
}